// The landing page reuses the app's own avatar renderer (and its pointer-following eyes).
import { avatarSvg } from '../src/renderer/ui';

const REPO = 'SUNGMYEONGGI/CharacterBot';
const DMG = 'CharacterBot-arm64.dmg';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

type Member = { name: string; shape: number; color: string; role: string };
const CAST: Record<string, Member> = {
  octo: { name: 'Octo', shape: 0, color: '#a0673b', role: 'main' },
  mina: { name: 'Mina', shape: 4, color: '#ef3b4b', role: 'comms' },
  ledger: { name: 'Ledger', shape: 1, color: '#2f7cf6', role: 'budget' },
  scout: { name: 'Scout', shape: 13, color: '#f26a1b', role: 'research' },
  pixel: { name: 'Pixel', shape: 3, color: '#8b5cf6', role: 'design' },
  inbox: { name: 'Inbox', shape: 6, color: '#20b15a', role: 'mail' },
};
const { octo, mina, ledger, scout, pixel } = CAST;

const avatar = (m: Member, size: number, state = 'idle') =>
  `<span class="avatar" data-st="${state}" style="width:${size}px;height:${size}px;--t0:-${Math.round(Math.random() * 5000)}ms">${avatarSvg(m.shape, m.color, size)}</span>`;

const castHtml = (size: number) => Object.values(CAST).map((m) => `<figure>${avatar(m, size)}<figcaption>${m.name}</figcaption></figure>`).join('');
const cast = $('cast');
if (cast) cast.innerHTML = castHtml(84);
const cast2 = $('cast2');
if (cast2) cast2.innerHTML = Object.values(CAST).map((m) => avatar(m, 44)).join('');
const hub = $('hubcast');
if (hub) hub.innerHTML = [octo, ledger, scout, pixel].map((m) => avatar(m, 30)).join('');
for (const el of document.querySelectorAll<HTMLElement>('[data-av]')) el.innerHTML = avatar(CAST[el.dataset.av!], 26);

// ---------- scripted demo ----------
// One run plays the scenario; Play again bumps the run id, which stops the old one.
const side = $('side');
if (side) {
  const row = (m: Member, on = false) => `<div class="row${on ? ' on' : ''}">${avatar(m, 22)}${m.name}<small>${m.role}</small></div>`;
  side.innerHTML = `<h4>Groups</h4><div class="row on"><span class="hash">#</span>Launch team</div><h4>Bots</h4>${[octo, ledger, scout, mina, pixel].map((m) => row(m)).join('')}`;
}
const msgs = $('thread');
const tmsgs = $('tmsgs');
const body = document.querySelector<HTMLElement>('.app-body');
const typing = $('typing');
const replay = $('replay');
let run = 0;

const you = (html: string) => `<div class="msg you"><p>${html}</p></div>`;
const bot = (m: Member, html: string, state = 'idle', extra = '') => `<div class="msg">${avatar(m, 30, state)}<div class="body"><b style="color:${m.color}">${m.name}</b><p>${html}</p>${extra}</div></div>`;
const at = (n: string) => `<span class="mention">@${n}</span>`;
const file = (n: string) => `<span class="file">📄 ${n}</span>`;
const approval = `<div class="approval"><div class="t"><img src="logos/gmail.svg" alt="" width="14" height="14"> Draft email to beta testers</div><p>Hi all, the beta opens Friday at 10:00. Here's what's new…</p><div class="acts"><button class="ok" type="button">Approve</button><button type="button">Edit</button></div></div>`;

const SCRIPT = {
  ask: 'Can we ship the beta on Friday? Check bugs, budget and feedback.',
  octo1: `On it. ${at('Ledger')} takes the budget, ${at('Scout')} reads the feedback, and I'll go through the bug tracker.`,
  ledger: 'We have $2,400 left this month. The beta adds about $300 in hosting.',
  scout: 'Most of the 41 survey answers ask for dark mode. Two people hit the same login loop.',
  t1: `${at('Pixel')} can you mock the error screen for that loop?`,
  t2: "Here's a first pass, with a retry button and a clearer message.",
  t3: "Thanks. I'll link it in the feedback summary.",
  mina: 'I drafted the announcement email. It waits for your approval.',
  octo2: 'Friday works if we fix the login loop first. The plan is in the launch doc.',
};

function add(el: HTMLElement, html: string): HTMLElement {
  el.insertAdjacentHTML('beforeend', html);
  return el.lastElementChild as HTMLElement;
}

function staticDemo() {
  if (!msgs || !tmsgs || !body) return;
  msgs.innerHTML = [you(SCRIPT.ask), bot(octo, SCRIPT.octo1), bot(scout, SCRIPT.scout, 'idle', '<button class="replies" type="button">3 replies</button>'),
    bot(mina, SCRIPT.mina, 'idle', approval.replace(/<div class="acts">.*?<\/div><\/div>$/, '<div class="done">Approved once</div></div>')), bot(octo, SCRIPT.octo2, 'idle', file('beta-launch.md'))].join('');
  tmsgs.innerHTML = [bot(scout, SCRIPT.scout), you(SCRIPT.t1), '<div class="join">Pixel joined the thread</div>', bot(pixel, SCRIPT.t2), bot(scout, SCRIPT.t3)].join('');
  body.classList.add('threaded');
}

async function play() {
  if (!msgs || !tmsgs || !body || !typing) return;
  const id = ++run;
  const wait = (ms: number) => new Promise<void>((ok, stop) => setTimeout(() => (id === run ? ok() : stop()), ms));
  msgs.innerHTML = ''; tmsgs.innerHTML = ''; typing.textContent = '';
  body.classList.remove('threaded');
  if (replay) replay.hidden = true;

  // A bot "thinks" with a typing bubble, then replies.
  async function say(el: HTMLElement, m: Member, html: string, { think = 900, state = 'thinking', extra = '' } = {}) {
    const dots = add(el, `<div class="msg">${avatar(m, 30, state)}<div class="typing"><i></i><i></i><i></i></div></div>`);
    await wait(think);
    dots.outerHTML = bot(m, html, 'streaming', extra);
    const last = el.lastElementChild as HTMLElement;
    await wait(700);
    last.querySelector('.avatar')?.setAttribute('data-st', 'idle');
    return last;
  }

  try {
    await wait(500);
    for (const ch of SCRIPT.ask) { typing.textContent += ch; await wait(28); }
    await wait(300);
    typing.textContent = '';
    add(msgs, you(SCRIPT.ask));
    await say(msgs, octo, SCRIPT.octo1, { think: 1100 });
    await say(msgs, ledger, SCRIPT.ledger, { state: 'working', think: 1300 });
    const sc = await say(msgs, scout, SCRIPT.scout, { state: 'working', think: 1200, extra: '<button class="replies" type="button">Reply in thread</button>' });
    await wait(700);

    // The thread opens beside the chat; an @mention pulls Pixel in.
    const rep = sc.querySelector<HTMLButtonElement>('.replies')!;
    body.classList.add('threaded');
    add(tmsgs, bot(scout, SCRIPT.scout));
    await wait(700);
    add(tmsgs, you(SCRIPT.t1));
    rep.textContent = '1 reply';
    await wait(700);
    add(tmsgs, '<div class="join">Pixel joined the thread</div>');
    await say(tmsgs, pixel, SCRIPT.t2, { think: 1200 });
    rep.textContent = '2 replies';
    await say(tmsgs, scout, SCRIPT.t3, { think: 700 });
    rep.textContent = '3 replies';
    await wait(900);

    // Approval: the visitor can click it, or it approves itself after a few seconds.
    const card = await say(msgs, mina, SCRIPT.mina, { think: 1000, extra: approval });
    const acts = card.querySelector<HTMLElement>('.acts')!;
    await Promise.race([wait(4500), new Promise<void>((ok) => acts.querySelector('.ok')!.addEventListener('click', () => ok(), { once: true }))]);
    if (id !== run) return;
    acts.outerHTML = '<div class="done">Approved once</div>';
    await wait(500);
    await say(msgs, octo, SCRIPT.octo2, { think: 1300, extra: file('beta-launch.md') });
    if (replay) replay.hidden = false;
  } catch { /* superseded by a newer run */ }
}

const app = $('app');
if (reduced) staticDemo();
else if (app) {
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); play(); } }, { threshold: 0.35 });
  io.observe(app);
  replay?.addEventListener('click', play);
}

// ---------- logo marquee ----------
const LOGOS: [string, string][] = [
  ['gmail.svg', 'Gmail'], ['slack.svg', 'Slack'], ['notion.png', 'Notion'], ['github.png', 'GitHub'], ['google-calendar.svg', 'Calendar'],
  ['google-drive.svg', 'Drive'], ['linear.svg', 'Linear'], ['figma.png', 'Figma'], ['stripe.svg', 'Stripe'], ['supabase.png', 'Supabase'],
  ['vercel.png', 'Vercel'], ['sentry.svg', 'Sentry'], ['airtable.png', 'Airtable'], ['miro.png', 'Miro'], ['dropbox.svg', 'Dropbox'],
  ['huggingface.png', 'Hugging Face'], ['cloudflare.png', 'Cloudflare'], ['posthog.svg', 'PostHog'], ['zapier.png', 'Zapier'], ['intercom.svg', 'Intercom'],
];
const marquee = $('marquee');
if (marquee) {
  const track = `<div class="track">${LOGOS.map(([f, n]) => `<span><img src="logos/${f}" alt="" loading="lazy">${n}</span>`).join('')}</div>`;
  marquee.innerHTML = track + track.replace('class="track"', 'class="track" aria-hidden="true"');
}

// ---------- SDK beams ----------
// Curves from each node to the nodes it names in data-from, redrawn on resize.
const beams = $('beams');
const svg = beams?.querySelector('svg');
function drawBeams() {
  if (!beams || !svg) return;
  const box = beams.getBoundingClientRect();
  const rel = (el: Element) => { const r = el.getBoundingClientRect(); return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 }; };
  let paths = '';
  let i = 0;
  for (const to of beams.querySelectorAll<HTMLElement>('[data-from]')) {
    for (const fromId of to.dataset.from!.split(' ')) {
      const from = beams.querySelector(`[data-id="${fromId}"]`);
      if (!from) continue;
      const a = rel(from), b = rel(to);
      const d = a.r < b.l
        ? `M${a.r},${a.cy} C${(a.r + b.l) / 2},${a.cy} ${(a.r + b.l) / 2},${b.cy} ${b.l},${b.cy}`
        : `M${a.cx},${a.b} C${a.cx},${(a.b + b.t) / 2} ${b.cx},${(a.b + b.t) / 2} ${b.cx},${b.t}`;
      paths += `<path class="base" d="${d}"/><path class="flow" d="${d}" pathLength="100" style="animation-delay:-${(i++ * 0.53) % 3.4}s"/>`;
    }
  }
  svg.innerHTML = paths;
}
if (beams) { new ResizeObserver(drawBeams).observe(beams); document.fonts?.ready.then(drawBeams); }

// ---------- activity log ----------
const LOG: [Member, string, string, string][] = [
  [octo, 'Routine "Morning briefing" started', '', ''],
  [octo, 'mcp__claude_ai_Gmail__search_threads', 'read', 'ok'],
  [ledger, 'Read budget.xlsx', 'allowed', 'ok'],
  [scout, 'WebFetch survey results', 'allowed', 'ok'],
  [scout, 'Write feedback.csv', 'allowed', 'ok'],
  [mina, 'Gmail draft to beta testers', 'waiting', 'wait'],
  [mina, 'Gmail draft to beta testers', 'approved', 'ok'],
  [octo, 'mcp__characterbot__schedule_routine', 'allowed', 'ok'],
  [pixel, 'Generate image error-screen.png', 'allowed', 'ok'],
  [octo, 'mcp__characterbot__remember', 'allowed', 'ok'],
  [octo, 'Slack post as you', 'blocked', ''],
];
const log = $('log');
if (log) {
  let n = 0;
  let sec = 9 * 3600;
  const line = () => {
    const [m, what, tag, cls] = LOG[n++ % LOG.length];
    sec += 1 + (n % 3) * 2;
    const t = [sec / 3600, (sec / 60) % 60, sec % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
    add(log, `<li><time>${t}</time>${avatar(m, 22)}<code>${what}</code>${tag ? `<span class="tag ${cls}">${tag}</span>` : '<span></span>'}</li>`);
    while (log.children.length > 9) log.firstElementChild!.remove();
  };
  for (let k = 0; k < 7; k++) line();
  if (!reduced) setInterval(line, 1800);
}

// ---------- latest release next to the download button ----------
fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
  .then((r) => (r.ok ? r.json() : null))
  .then((rel: { tag_name: string; published_at: string; assets: { name: string; size: number }[] } | null) => {
    const el = $('release');
    if (!rel || !el) return;
    const dmg = rel.assets.find((a) => a.name === DMG);
    const date = new Date(rel.published_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    const size = dmg ? `, ${Math.round(dmg.size / 1e6)} MB` : '';
    el.innerHTML = `Version ${rel.tag_name.replace(/^v/, '')}, released ${date}${size}. Apple silicon, macOS 12 or later. <a href="https://github.com/${REPO}/releases/tag/${rel.tag_name}">Release notes</a>`;
  })
  .catch(() => {});
