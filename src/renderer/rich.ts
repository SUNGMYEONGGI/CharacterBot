// Rich content in chat: markdown with KaTeX math, Mermaid diagrams, the
// full-screen file viewer and voice memo audio helpers.
import { marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { Message } from '../shared/types';
import { h, fill, icon, openModal, closeModal } from './ui';

type MathToken = Tokens.Generic & { text: string; display?: boolean };

// ---------- markdown + math ----------

const tex = (text: string, displayMode: boolean): string => katex.renderToString(text, { throwOnError: false, displayMode });
marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start: (src: string) => src.match(/^\$\$/m)?.index,
      tokenizer(src: string) {
        const m = /^\$\$\s*([\s\S]+?)\s*\$\$(?:\n|$)/.exec(src);
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1] };
      },
      renderer: (t: Tokens.Generic) => `<div class="math-block">${tex((t as MathToken).text, true)}</div>`,
    },
    {
      name: 'math',
      level: 'inline',
      start: (src: string) => { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
      // $x$ but not prices like "$5 and $10": no space inside the dollars, no digit after.
      tokenizer(src: string) {
        const m = /^\$\$([^$]+?)\$\$/.exec(src) || /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/.exec(src);
        if (m) return { type: 'math', raw: m[0], text: m[1], display: m[0].startsWith('$$') };
      },
      renderer: (t: Tokens.Generic) => tex((t as MathToken).text, Boolean((t as MathToken).display)),
    },
  ],
});
DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => { if (node.tagName === 'A') node.setAttribute('target', '_blank'); });
export const md = (text: string | undefined): string => DOMPurify.sanitize(marked.parse(text || '', { async: false }));

// ---------- mermaid ----------

let mermaidLib: Promise<typeof import('mermaid').default> | undefined;
const diagrams = new Map<string, string | null>(); // source -> svg markup (null when it doesn't parse)
const dark = () => document.documentElement.dataset.theme === 'dark'
  || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

async function drawMermaid(src: string): Promise<string | null> {
  const key = `${dark()}\n${src}`;
  if (diagrams.has(key)) return diagrams.get(key) ?? null;
  mermaidLib ||= import('mermaid').then((m) => m.default); // large: its own chunk, loaded on first diagram
  const mermaid = await mermaidLib;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark() ? 'dark' : 'default', fontFamily: 'inherit' });
  let svg: string | null = null;
  try {
    svg = (await mermaid.render(`mmd${diagrams.size}`, src)).svg;
  } catch {}
  diagrams.set(key, svg);
  return svg;
}

// Swaps ```mermaid code blocks under root for the drawn diagram.
export function renderDiagrams(root: ParentNode): void {
  for (const code of root.querySelectorAll('pre > code.language-mermaid')) {
    const pre = code.parentElement;
    if (!pre) continue;
    const src = code.textContent || '';
    const put = (svg: string | null | undefined) => {
      if (!svg || !pre.parentNode) return;
      pre.replaceWith(h('div', { class: 'diagram', title: '다이어그램 전체 화면으로 열기', html: svg, onclick: () => openViewer({ kind: 'svg', name: '다이어그램', svg }) }));
    };
    const key = `${dark()}\n${src}`;
    if (diagrams.has(key)) put(diagrams.get(key));
    else drawMermaid(src).then(put);
  }
}

// ---------- full-screen viewer ----------

export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// file: { kind: image|svg|markdown|table|sheets|pdf|text|html|other, name, dataUrl?, svg?, text?, ext?, url?, sheets? }
// openExternal: opens it in the default app (shown when given).
export interface ViewerFile {
  kind: string;
  name: string;
  dataUrl?: string;
  svg?: string;
  text?: string;
  ext?: string;
  url?: string;
  sheets?: { name: string; rows: string[][] }[];
}

const grid = ([head = [], ...all]: string[][]): HTMLElement => {
  const rows = all.slice(0, 2000);
  const width = Math.max(head.length, ...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return h('div', { class: 'viewer-table' }, h('table', {},
    h('thead', {}, h('tr', {}, pad(head).map((c) => h('th', {}, c)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, pad(r).map((c) => h('td', {}, c)))))));
};

// One tab per worksheet.
function sheetsView(sheets: NonNullable<ViewerFile['sheets']>): HTMLElement {
  if (!sheets.length) return h('div', { class: 'viewer-none muted' }, icon('file', 34), '시트를 읽지 못했어요');
  const view = h('div', { class: 'viewer-sheets' });
  const show = (i: number): void => void fill(view,
    sheets.length > 1 ? h('div', { class: 'sheet-tabs row' }, sheets.map((sh, j) => h('button', { class: `btn ${j === i ? 'soft' : 'ghost'}`, onclick: () => show(j) }, sh.name))) : null,
    grid(sheets[i].rows));
  show(0);
  return view;
}

export function openViewer(file: ViewerFile, openExternal: (() => void) | null = null): void {
  let body: HTMLElement;
  if (file.kind === 'image') body = h('img', { class: 'viewer-img', src: file.dataUrl, alt: file.name });
  else if (file.kind === 'svg') body = h('div', { class: 'viewer-svg', html: file.svg });
  else if (file.kind === 'markdown') body = h('div', { class: 'viewer-doc msg bot', html: md(file.text) });
  else if (file.kind === 'html') body = h('iframe', { class: 'viewer-frame', sandbox: 'allow-scripts', src: file.url });
  else if (file.kind === 'pdf') body = h('iframe', { class: 'viewer-frame', src: file.url }); // no sandbox: it would block the PDF viewer
  else if (file.kind === 'table') body = grid(parseCsv(file.text || '', file.ext === '.tsv' ? '\t' : ','));
  else if (file.kind === 'sheets') body = sheetsView(file.sheets || []);
  else if (file.kind === 'text') body = h('pre', { class: 'viewer-text' }, file.text);
  else body = h('div', { class: 'viewer-none muted' }, icon('file', 34), '이 파일은 여기서 미리 볼 수 없어요');
  if (body.classList.contains('viewer-doc')) renderDiagrams(body);
  openModal(h('div', { class: 'modal viewer' },
    h('div', { class: 'viewer-head row' },
      h('span', { class: 'grow ellipsis' }, file.name),
      openExternal ? h('button', { class: 'btn ghost', onclick: openExternal }, icon('external', 15), ' 기본 앱으로 열기') : null,
      h('button', { class: 'circle-btn', title: '전체 화면 종료', onclick: closeModal }, icon('close', 18))),
    h('div', { class: 'viewer-body' }, body)));
}

// ---------- voice memos ----------

export const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.readAsDataURL(blob);
});

// Recorded audio (webm/opus) -> 16 kHz mono 16-bit WAV data URL for transcription.
export async function toWav16k(blob: Blob): Promise<string> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return blobToDataUrl(new Blob([view], { type: 'audio/wav' }));
}

export const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// A voice memo bubble with play/pause and progress. Cached per message so a
// re-render doesn't stop playback.
const voiceEls = new Map<string, HTMLElement>();
export function voiceBubble(m: Message & { voice: NonNullable<Message['voice']> }): HTMLElement {
  const cached = voiceEls.get(m.id);
  if (cached) return cached;
  const audio = h('audio', { src: m.voice.dataUrl, preload: 'metadata' });
  const bar = h('i');
  const btn = h('button', { class: 'play', title: '음성 메모 재생', onclick: () => (audio.paused ? audio.play() : audio.pause()) }, icon('play', 14));
  audio.onplay = () => fill(btn, icon('pause', 14));
  audio.onpause = () => fill(btn, icon('play', 14));
  audio.ontimeupdate = () => { bar.style.width = `${Math.min(100, (audio.currentTime / m.voice.duration) * 100)}%`; };
  const el = h('div', { class: 'msg user voice' },
    h('div', { class: 'voice-row' }, btn, h('span', { class: 'voice-track' }, bar), h('span', { class: 'small' }, clock(m.voice.duration)), audio),
    h('div', { class: 'voice-text' }, m.content));
  voiceEls.set(m.id, el);
  return el;
}
