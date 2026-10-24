// Rich content in chat: markdown with KaTeX math, Mermaid diagrams, the
// full-screen file viewer and voice memo audio helpers.
import { marked } from './node_modules/marked/lib/marked.esm.js';
import DOMPurify from './node_modules/dompurify/dist/purify.es.mjs';
import katex from './node_modules/katex/dist/katex.mjs';
import { h, fill, icon, openModal, closeModal } from './ui.js';

// ---------- markdown + math ----------

const tex = (text, displayMode) => katex.renderToString(text, { throwOnError: false, displayMode });
marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start: (src) => src.match(/^\$\$/m)?.index,
      tokenizer(src) {
        const m = /^\$\$\s*([\s\S]+?)\s*\$\$(?:\n|$)/.exec(src);
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1] };
      },
      renderer: (t) => `<div class="math-block">${tex(t.text, true)}</div>`,
    },
    {
      name: 'math',
      level: 'inline',
      start: (src) => { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
      // $x$ but not prices like "$5 and $10": no space inside the dollars, no digit after.
      tokenizer(src) {
        const m = /^\$\$([^$]+?)\$\$/.exec(src) || /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/.exec(src);
        if (m) return { type: 'math', raw: m[0], text: m[1], display: m[0].startsWith('$$') };
      },
      renderer: (t) => tex(t.text, t.display),
    },
  ],
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => { if (node.tagName === 'A') node.setAttribute('target', '_blank'); });
export const md = (text) => DOMPurify.sanitize(marked.parse(text || ''));

// ---------- mermaid ----------

let mermaidLib;
const diagrams = new Map(); // source -> svg markup (null when it doesn't parse)
const dark = () => document.documentElement.dataset.theme === 'dark'
  || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

async function drawMermaid(src) {
  const key = `${dark()}\n${src}`;
  if (diagrams.has(key)) return diagrams.get(key);
  mermaidLib ||= import('./node_modules/mermaid/dist/mermaid.esm.min.mjs').then((m) => m.default);
  const mermaid = await mermaidLib;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark() ? 'dark' : 'default', fontFamily: 'inherit' });
  let svg = null;
  try {
    svg = (await mermaid.render(`mmd${diagrams.size}`, src)).svg;
  } catch {}
  diagrams.set(key, svg);
  return svg;
}

// Swaps ```mermaid code blocks under root for the drawn diagram.
export function renderDiagrams(root) {
  for (const code of root.querySelectorAll('pre > code.language-mermaid')) {
    const pre = code.parentElement;
    const src = code.textContent;
    const put = (svg) => {
      if (!svg || !pre.parentNode) return;
      pre.replaceWith(h('div', { class: 'diagram', title: '다이어그램 전체 화면으로 열기', html: svg, onclick: () => openViewer({ kind: 'svg', name: '다이어그램', svg }) }));
    };
    const key = `${dark()}\n${src}`;
    if (diagrams.has(key)) put(diagrams.get(key));
    else drawMermaid(src).then(put);
  }
}

// ---------- full-screen viewer ----------

export function parseCsv(text, sep) {
  const rows = [];
  let row = [];
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

// file: { kind: image|svg|markdown|table|text|html|other, name, dataUrl?, svg?, text?, ext?, url? }
// openExternal: opens it in the default app (shown when given).
export function openViewer(file, openExternal = null) {
  let body;
  if (file.kind === 'image') body = h('img', { class: 'viewer-img', src: file.dataUrl, alt: file.name });
  else if (file.kind === 'svg') body = h('div', { class: 'viewer-svg', html: file.svg });
  else if (file.kind === 'markdown') body = h('div', { class: 'viewer-doc msg bot', html: md(file.text) });
  else if (file.kind === 'html') body = h('iframe', { class: 'viewer-frame', sandbox: 'allow-scripts', src: file.url });
  else if (file.kind === 'table') {
    const [head = [], ...rows] = parseCsv(file.text, file.ext === '.tsv' ? '\t' : ',');
    body = h('div', { class: 'viewer-table' }, h('table', {},
      h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, c)))),
      h('tbody', {}, rows.slice(0, 2000).map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
  } else if (file.kind === 'text') body = h('pre', { class: 'viewer-text' }, file.text);
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

export const blobToDataUrl = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(blob);
});

// Recorded audio (webm/opus) -> 16 kHz mono 16-bit WAV data URL for transcription.
export async function toWav16k(blob) {
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
  const str = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return blobToDataUrl(new Blob([view], { type: 'audio/wav' }));
}

export const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// A voice memo bubble with play/pause and progress. Cached per message so a
// re-render doesn't stop playback.
const voiceEls = new Map();
export function voiceBubble(m) {
  if (voiceEls.has(m.id)) return voiceEls.get(m.id);
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
