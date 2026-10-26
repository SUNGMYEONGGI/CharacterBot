// Reads an .xlsx file into rows of text for the library viewer. An .xlsx is a
// zip of XML parts; macOS's own unzip extracts them, so no spreadsheet library.
// ponytail: values only (no formatting, dates stay serial numbers); use a real parser if people need more.
import { execFileSync } from 'node:child_process';

export interface Sheet {
  name: string;
  rows: string[][];
}

const unescape = (s: string): string => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

// The text of every <t> inside a string item (rich text has several runs).
const runs = (xml: string): string => unescape([...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join(''));

export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]));
}

// "C12" -> 2 (zero-based column)
const column = (ref: string): number => [...ref.replace(/\d+$/, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export function sheetRows(xml: string, strings: string[], maxRows = 2000): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(/\br="(\d+)"/.exec(row[1])?.[1]) || rows.length + 1;
    while (rows.length < Math.min(r - 1, maxRows)) rows.push([]); // rows with no cells are left out of the file
    if (rows.length >= maxRows) break;
    const cells: string[] = [];
    let next = 0;
    for (const c of (row[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1];
      const at = ref ? column(ref) : next;
      const type = /\bt="(\w+)"/.exec(c[1])?.[1];
      const v = /<v>([^<]*)<\/v>/.exec(c[2] || '')?.[1];
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

// Sheet names in workbook order, mapped to their part paths through the relationships file.
export function sheetParts(workbook: string, rels: string): { name: string; part: string }[] {
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    /\bId="([^"]+)"/.exec(m[0])?.[1], /\bTarget="([^"]+)"/.exec(m[0])?.[1] || '',
  ]));
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const target = targets.get(/\br:id="([^"]+)"/.exec(m[0])?.[1]) || '';
    return { name: unescape(/\bname="([^"]*)"/.exec(m[0])?.[1] || ''), part: target.startsWith('/') ? target.slice(1) : `xl/${target}` };
  }).filter((s) => s.part !== 'xl/');
}

const part = (file: string, name: string): string => {
  try {
    return execFileSync('/usr/bin/unzip', ['-p', file, name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
  } catch {
    return '';
  }
};

export function readXlsx(file: string, maxSheets = 20): Sheet[] {
  const strings = sharedStrings(part(file, 'xl/sharedStrings.xml'));
  return sheetParts(part(file, 'xl/workbook.xml'), part(file, 'xl/_rels/workbook.xml.rels'))
    .slice(0, maxSheets)
    .map(({ name, part: p }) => ({ name, rows: sheetRows(part(file, p), strings) }));
}
