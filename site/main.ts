// The landing page reuses the app's own avatar renderer (and its pointer-following eyes).
import { avatarSvg } from '../src/renderer/ui';

const REPO = 'SUNGMYEONGGI/CharacterBot';
const DMG = 'CharacterBot-arm64.dmg';

type Member = { name: string; shape: number; color: string; state?: string };
const CAST: Member[] = [
  { name: 'Grok', shape: 0, color: '#a0673b' },
  { name: 'Mina', shape: 4, color: '#ef3b4b' },
  { name: 'Ledger', shape: 1, color: '#2f7cf6' },
  { name: 'Scout', shape: 13, color: '#f26a1b' },
  { name: 'Inbox', shape: 6, color: '#20b15a' },
  { name: 'Pixel', shape: 3, color: '#8b5cf6' },
];

const avatar = (m: Member, size: number, state = 'idle') =>
  `<span class="avatar" data-st="${state}" style="width:${size}px;height:${size}px;--t0:-${Math.round(Math.random() * 5000)}ms">${avatarSvg(m.shape, m.color, size)}</span>`;

const cast = document.getElementById('cast');
if (cast) cast.innerHTML = CAST.map((m) => `<figure>${avatar(m, 96)}<figcaption>${m.name}</figcaption></figure>`).join('');

// A short group chat: the main bot splits the work and the team reports back.
const [grok, mina, ledger, scout] = CAST;
const thread = document.getElementById('thread');
if (thread) {
  const you = (text: string) => `<div class="msg you"><p>${text}</p></div>`;
  const bot = (m: Member, text: string, state?: string) => `<div class="msg bot">${avatar(m, 30, state)}<div><b style="color:${m.color}">${m.name}</b><p>${text}</p></div></div>`;
  thread.innerHTML = [
    you('Can we launch the beta on Friday? Check the open bugs, the budget and what people are saying.'),
    bot(grok, 'On it. <span class="mention">@Ledger</span> takes the budget, <span class="mention">@Scout</span> reads the feedback, and I\'ll go through the bug tracker.'),
    bot(ledger, 'We have 2,400 left this month. The beta adds about 300 in hosting.'),
    bot(scout, 'Most of the 41 survey answers ask for dark mode. Two people hit the same login loop.'),
    bot(mina, 'I drafted the announcement email. It\'s waiting for your approval.'),
    bot(grok, 'Friday works if we fix the login loop first. I put the plan in <u>beta-launch.md</u>.', 'streaming'),
  ].join('');
}

// Latest release: version, date and size next to the download button.
fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
  .then((r) => (r.ok ? r.json() : null))
  .then((rel: { tag_name: string; published_at: string; assets: { name: string; size: number }[] } | null) => {
    const el = document.getElementById('release');
    if (!rel || !el) return;
    const dmg = rel.assets.find((a) => a.name === DMG);
    const date = new Date(rel.published_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    const size = dmg ? `, ${Math.round(dmg.size / 1e6)} MB` : '';
    el.innerHTML = `Version ${rel.tag_name.replace(/^v/, '')}, released ${date}${size}. Apple silicon, macOS 12 or later. <a href="https://github.com/${REPO}/releases/tag/${rel.tag_name}">Release notes</a>`;
  })
  .catch(() => {});
