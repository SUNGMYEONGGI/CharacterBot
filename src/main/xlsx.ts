// Reads an .xlsx file into rows of text for the library viewer. An .xlsx is a
// zip of XML parts; macOS's own unzip extracts them, so no spreadsheet library.
// ponytail: values only (no formatting, dates stay serial numbers); use a real parser if people need more.
import { execFile } from 'node:child_process';
import path from 'node:path';

export interface Sheet {
  name: string;
  rows: string[][];
}

const unescape = (s: string): string => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

// Some writers prefix every element (<x:row>), so each tag allows an optional namespace prefix.
const P = '(?:[A-Za-z_][\\w.-]*:)?';
const tag = (name: string, flags = 'g') => new RegExp(`<${P}${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}${name}>)`, flags);

// The text of every <t> inside a string item (rich text has several runs).
const runs = (xml: string): string => unescape([...xml.matchAll(tag('t'))].map((m) => m[2] || '').join(''));

export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(tag('si'))].map((m) => runs(m[2] || ''));
}

// "C12" -> 2 (zero-based column)
const column = (ref: string): number => [...ref.replace(/\d+$/, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export function sheetRows(xml: string, strings: string[], maxRows = 2000): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(tag('row'))) {
    const r = Number(/\br="(\d+)"/.exec(row[1])?.[1]) || rows.length + 1;
    while (rows.length < Math.min(r - 1, maxRows)) rows.push([]); // rows with no cells are left out of the file
    if (rows.length >= maxRows) break;
    const cells: string[] = [];
    let next = 0;
    for (const c of (row[2] || '').matchAll(tag('c'))) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1];
      const at = ref ? column(ref) : next;
      const type = /\bt="(\w+)"/.exec(c[1])?.[1];
      const v = tag('v', '').exec(c[2] || '')?.[2];
      const value = type === 's' ? strings[Number(v)] ?? ''
        : type === 'inlineStr' ? runs(c[2] || '')
        : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
        : unescape(v ?? '');
      while (cells.length < at) cells.push('');
      cells[at] = value;
      next = at + 1;
    }
    rows.push(cells);
  }
  return rows;
}

// Sheet names in workbook order, mapped to their zip entries through the
// relationships file. Targets are relative to xl/ ("../xl/…" included) or absolute ("/xl/…").
export function sheetParts(workbook: string, rels: string): { name: string; part: string }[] {
  const targets = new Map([...rels.matchAll(tag('Relationship'))].map((m) => [
    /\bId="([^"]+)"/.exec(m[1])?.[1], /\bTarget="([^"]+)"/.exec(m[1])?.[1] || '',
  ]));
  return [...workbook.matchAll(tag('sheet'))].flatMap((m) => {
    const target = targets.get(/\br:id="([^"]+)"/.exec(m[1])?.[1]);
    if (!target) return [];
    const part = path.posix.normalize(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    return part.startsWith('../') ? [] : [{ name: unescape(/\bname="([^"]*)"/.exec(m[1])?.[1] || ''), part }];
  });
}

// One zip entry as text; '' when it is missing or the time left runs out.
const part = (file: string, name: string, deadline: number): Promise<string> => {
  const timeout = deadline - Date.now();
  if (timeout <= 0) return Promise.resolve('');
  return new Promise((resolve) => {
    execFile('/usr/bin/unzip', ['-p', file, name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout }, (err, out) => resolve(err ? '' : out));
  });
};

// Runs off the main thread's event loop (unzip is a child process) and gives up after 20 seconds in all.
export async function readXlsx(file: string, maxSheets = 20): Promise<Sheet[]> {
  const deadline = Date.now() + 20_000;
  const [strings, workbook, rels] = await Promise.all(['xl/sharedStrings.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'].map((n) => part(file, n, deadline)));
  const shared = sharedStrings(strings);
  const sheets: Sheet[] = [];
  for (const { name, part: p } of sheetParts(workbook, rels).slice(0, maxSheets)) {
    sheets.push({ name, rows: sheetRows(await part(file, p, deadline), shared) });
  }
  return sheets;
}
