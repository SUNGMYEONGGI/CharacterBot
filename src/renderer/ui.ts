// DOM helpers, icons and bot avatars shared by every view.
import type { Actions } from '../main/main';
import type { Bot, ModelInfo } from '../shared/types';

// The app's own markup (index.html) always has these nodes.
export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

// Event handlers by name (onclick, oninput, ...), typed from the DOM event map.
// `target` is typed as an input because most handlers read its value or checked.
type Handlers = { [K in keyof HTMLElementEventMap as `on${K}`]?: (e: HTMLElementEventMap[K] & { target: HTMLInputElement }) => unknown };
export type Props = Handlers & { [attr: string]: unknown };
// A child: a node, text, or nothing (null/false/undefined are skipped), nested freely.
export type Child = Node | string | number | null | undefined | false | Child[];

// h('div', { class, onclick, html, ... }, ...children); null/false children are skipped.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement;
export function h(tag: string, props: Props | null = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'html') el.innerHTML = String(value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'value' || key === 'checked' || key === 'disabled') (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of (children as unknown[]).flat(3) as Child[]) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// replaceChildren() that skips null/false instead of rendering them as text.
export const fill = (el: Element, ...kids: Child[]): void =>
  el.replaceChildren(...((kids as unknown[]).flat(3) as Child[]).filter((k): k is Node | string | number => k != null && k !== false).map((k) => (typeof k === 'number' ? String(k) : k)));

// ---------- icons (1.6px strokes on a 24 grid) ----------

const ICONS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<path d="M12 15V4m0 0L8 8m4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><path d="M16.75 13.5v6.5M13.5 16.75H20"/>',
  send: '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  clip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  monitor: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  chart: '<path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/>',
  gauge: '<path d="M4.5 16a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  file: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  sparkle: '<path d="M12 4c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M16 7l2.5 2.5M14 9l1.5 1.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h11"/>',
  message: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M5 19h14"/>',
  external: '<path d="M8 16 16 8M10 8h6v6"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  command: '<path d="M9 6.5a2.5 2.5 0 1 0-2.5 2.5H9zm0 0V17.5m0-8.5h6M9 15h6m0-8.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v11m0-2.5h2.5A2.5 2.5 0 1 1 15 17.5zM9 15H6.5A2.5 2.5 0 1 0 9 17.5z"/>',
  users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 6.2a3 3 0 0 1 0 5.6M17 14.2a5.5 5.5 0 0 1 3.5 4.8"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  update: '<path d="M12 20V10m0 0-4 4m4-4 4 4"/><path d="M7 17.5A4.5 4.5 0 0 1 7.5 8.5a5.5 5.5 0 0 1 10.6 1.5A3.75 3.75 0 0 1 17 17.5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  openai: '<path fill="currentColor" stroke="none" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>',
  image: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m20.5 15-4.5-4.5L6 20.5"/>',
  at: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7"/>',
  pin: '<path d="M15 4.5 19.5 9l-3.5 1.5-3 3 .5 4-1.5 1.5L8 15l-4 4"/><path d="m8 15 4.5-4.5"/><path d="M8 11 13 6"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a13 13 0 0 1-2.9 3.6M6.4 7.6A13 13 0 0 0 2.5 12c1 2 4.5 6 9.5 6a9.6 9.6 0 0 0 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  wave: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>',
  userPlus: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 11.5-4M18 14v6M15 17h6"/>',
  smile: '<circle cx="12" cy="12" r="8"/><path d="M8.8 14a4 4 0 0 0 6.4 0M9.5 10h.01M14.5 10h.01"/>',
  thread: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 15h-6l-4.5 4v-4H5a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 5 5z"/><path d="M8 9.5h8M8 12h5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  tool: '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5L15 12l-3-3z"/>',
};

export function icon(name: string, size = 18): HTMLElement {
  return h('span', {
    class: 'icon',
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`,
  });
}

// ---------- bot avatars: procedural blob shapes with two eyes ----------

// r(θ) = 1 + a·cos(n·θ + phase), sampled and scaled to fit a 100×100 box.
type Pt = [number, number];
function polar(n: number, a: number, phase = 0, squash = 1): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    const r = 1 + a * Math.cos(n * t + phase);
    pts.push([Math.cos(t) * r, Math.sin(t) * r * squash]);
  }
  return pts;
}

function superellipse(rx: number, ry: number, p: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([Math.sign(c) * Math.abs(c) ** (2 / p) * rx, Math.sign(s) * Math.abs(s) ** (2 / p) * ry]);
  }
  return pts;
}

function egg(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    pts.push([Math.cos(t) * (1 + 0.1 * Math.sin(t)) * 0.9, Math.sin(t)]);
  }
  return pts;
}

const SHAPE_POINTS = [
  () => polar(0, 0),
  () => superellipse(1, 1, 4),
  () => polar(4, 0.16, Math.PI),
  () => polar(5, 0.12, Math.PI / 2),
  () => polar(6, 0.17, Math.PI / 2),
  () => polar(3, 0.16, Math.PI / 2),
  () => polar(7, 0.07),
  () => polar(9, 0.05),
  () => polar(6, 0.06),
  () => superellipse(1, 0.78, 3),
  egg,
  () => polar(4, 0.13),
  () => polar(2, 0.1, Math.PI / 2),
  () => polar(0, 0, 0, 0.92), // fruit: a round body plus a leaf (drawn separately)
];
export const SHAPE_COUNT = SHAPE_POINTS.length;

const pathCache = new Map<number, string>();
function shapePath(i: number): string {
  const cached = pathCache.get(i);
  if (cached) return cached;
  const pts = SHAPE_POINTS[i]();
  const max = Math.max(...pts.flat().map(Math.abs));
  const scaled = pts.map(([x, y]) => [50 + (x / max) * 45, 52 + (y / max) * 45]);
  // Closed Catmull-Rom curve through the samples for smooth edges.
  let d = `M${scaled[0][0].toFixed(1)},${scaled[0][1].toFixed(1)}`;
  for (let k = 0; k < scaled.length; k++) {
    const p0 = scaled[(k - 1 + scaled.length) % scaled.length];
    const p1 = scaled[k];
    const p2 = scaled[(k + 1) % scaled.length];
    const p3 = scaled[(k + 2) % scaled.length];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1.map((v) => v.toFixed(1))} ${c2.map((v) => v.toFixed(1))} ${p2.map((v) => v.toFixed(1))}`;
  }
  pathCache.set(i, `${d}Z`);
  return `${d}Z`;
}

// Body and eyes are separate groups so CSS can animate them: .av-body moves the
// whole bot, .av-look shifts the eyes (gaze), .eye blinks.
export function avatarSvg(shape = 0, color = '#999', size = 40, { sleeping = false } = {}): string {
  const i = Number.isInteger(shape) && shape < SHAPE_COUNT ? shape : 0;
  const leaf = i === SHAPE_COUNT - 1 ? '<path d="M52 9c6-6 14-6 18-3-4 5-11 7-18 3z" fill="#2ec27e"/><path d="M51 12l-2-8" stroke="#3a2a1a" stroke-width="2.5" stroke-linecap="round"/>' : '';
  const eyes = sleeping
    ? '<rect x="38" y="47" width="10" height="5" rx="2.5" fill="#fff"/><rect x="54" y="47" width="10" height="5" rx="2.5" fill="#fff"/>'
    : '<g class="av-look"><g transform="rotate(-14 62 35)"><rect class="eye" x="52" y="27" width="7" height="17" rx="3.5" fill="#fff"/><rect class="eye" x="65" y="27" width="7" height="17" rx="3.5" fill="#fff"/></g></g>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" overflow="visible"><g class="av-body"><path d="${shapePath(i)}" fill="${color}"/>${leaf}${eyes}</g></svg>`;
}

// Older saves stored shapes as names.
const LEGACY_SHAPES: Record<string, number> = { hex: 8, square: 1 };
export const shapeOf = (bot: Partial<Bot> | null | undefined): number => (typeof bot?.shape === 'number' ? bot.shape : LEGACY_SHAPES[String(bot?.shape)] ?? 0);

// What a bot is doing right now (idle, thinking, streaming, working, blocked,
// finished), as in Grok Bot's animated avatars. The app installs the resolver.
let stateOf: (botId: string) => string = () => 'idle';
export const setAvatarState = (fn: (botId: string) => string): void => { stateOf = fn; };

export function avatar(bot: Partial<Bot> | null | undefined, size: number, state = bot?.id ? stateOf(bot.id) : 'idle'): HTMLElement {
  // A negative delay keeps looping animations in phase across re-renders.
  const attrs = { 'data-bot': bot?.id || null, 'data-st': state, style: `width:${size}px;height:${size}px;--t0:-${Date.now() % 6000}ms` };
  if (bot?.image) return h('span', { ...attrs, class: 'avatar img' }, h('img', { src: bot.image, alt: '' }));
  return h('span', { ...attrs, class: 'avatar', html: avatarSvg(shapeOf(bot), bot?.color || '#999', size) });
}

// Idle eyes follow the pointer.
let gazeFrame = 0;
document.addEventListener('mousemove', (e) => {
  if (gazeFrame) return;
  gazeFrame = requestAnimationFrame(() => {
    gazeFrame = 0;
    for (const el of document.querySelectorAll<SVGElement>('.avatar[data-st="idle"] .av-look')) {
      const r = el.closest('.avatar')?.getBoundingClientRect();
      if (!r?.width) continue;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 300) * 6;
      el.style.transform = `translate(${((dx / d) * k).toFixed(2)}px, ${((dy / d) * k).toFixed(2)}px)`;
    }
  });
});

export const initials = (name = ''): string => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '나';

export function userAvatar(name: string, size: number): HTMLElement {
  return h('span', { class: 'user-avatar', style: `width:${size}px;height:${size}px;font-size:${Math.max(8, size * 0.36)}px` }, initials(name));
}

// ---------- misc ----------

// Versioned name of a model value ("opus" -> "Opus 5.5"); '' is the provider default.
export function modelName(models: ModelInfo[] | undefined, value: string): string {
  const m = models?.find((x) => x.value === value);
  return m ? m.name : value ? value[0].toUpperCase() + value.slice(1) : '기본값';
}

// [value, label] pairs for a model <select>. `inherit` labels the '' option.
export function modelOptions(models: ModelInfo[] | undefined, inherit: string): [string, string][] {
  const list = models?.length ? models : ['', 'opus', 'sonnet', 'haiku', 'fable'].map((value) => ({ value }));
  return list.map((m): [string, string] => [m.value, m.value === '' ? inherit : `${m.value.startsWith('openai:') ? 'ChatGPT · ' : ''}${modelName(models, m.value)}`]);
}

// True while the user is typing inside el, so a re-render would steal input.
export const editing = (el: Element): boolean => el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string): void {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// Calls a main-process action; failures surface as a toast.
export async function act<K extends keyof Actions>(name: K, ...args: Parameters<Actions[K]>): Promise<Awaited<ReturnType<Actions[K]>> | undefined> {
  try {
    return await window.desktop.act(name, ...args);
  } catch (err) {
    toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    return undefined;
  }
}

let onModalClose: (() => void) | null = null;
export function openModal(node: Child, onClose: (() => void) | null = null): void {
  document.querySelectorAll('.popover').forEach((x) => x.remove());
  onModalClose?.();
  onModalClose = onClose;
  fill($('#overlay'), node);
  $('#overlay').classList.add('open');
  $('#overlay').onmousedown = (e) => { if ((e.target as HTMLElement).id === 'overlay') closeModal(); };
}

export function closeModal(): void {
  const cb = onModalClose;
  onModalClose = null;
  $('#overlay').classList.remove('open');
  $('#overlay').replaceChildren();
  cb?.();
}

export const modalOpen = () => $('#overlay').classList.contains('open');

export function toggle(checked: boolean, onchange: (checked: boolean) => void): HTMLInputElement {
  return h('input', { type: 'checkbox', class: 'toggle', checked, onchange: (e) => onchange(e.target.checked) });
}

// Popover menu anchored to an element; closes on outside click.
export interface MenuItem {
  label?: string;
  icon?: string;
  hint?: string;
  class?: string;
  chevron?: boolean;
  header?: string;
  onclick?: () => void;
}

// Falsy items are skipped, so callers can list conditional entries inline.
export function popover(anchor: Element, items: (MenuItem | '-' | null | false | undefined)[], { place = 'below' } = {}): HTMLElement {
  document.querySelectorAll('.popover').forEach((x) => x.remove());
  const rect = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'popover menu' }, items.filter((it) => it !== null && it !== false && it !== undefined).map((it) => (it === '-' ? h('div', { class: 'sep' }) : it.header ? h('div', { class: 'menu-head' }, it.header) : h('button', {
    class: it.class || '',
    onclick: () => { close(); it.onclick?.(); },
  }, it.icon ? icon(it.icon, 16) : null, h('span', { class: 'grow' }, it.label), it.hint ? h('span', { class: 'muted small' }, it.hint) : null, it.chevron ? icon('chevron', 14) : null))));
  const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) close(); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.body.append(menu);
  const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = place === 'above' ? `${rect.top - menu.offsetHeight - 8}px` : `${rect.bottom + 6}px`;
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc, true); });
  return menu;
}

export function relativeDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `오늘 ${time}`;
  if (days === 1) return `어제 ${time}`;
  return `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} ${time}`;
}
