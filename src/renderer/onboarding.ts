// First-run setup, in the same order as Grok Bot: welcome, sign in to the AI
// accounts the bots run on (subscription or API key), the user's name, a starter
// team, then a first task for the main bot. Finishing sets settings.onboarded.
import type { Broadcast, Conv } from '../shared/types';
import { h, fill, act, icon, avatar, toast, type Child } from './ui';

export type Template = { name: string; description: string };
type Deps = { templates: Template[]; createTeam: (picked: Template[]) => Promise<void>; select: (convId: string) => void };
type Step = 'welcome' | 'accounts' | 'name' | 'team' | 'task' | 'preparing';

const STEPS: Step[] = ['welcome', 'accounts', 'name', 'team', 'task'];
const TASKS = [
  '오늘 할 일을 정리해 줘',
  '내 작업 폴더에 메모장 파일을 하나 만들어 줘',
  '이 앱으로 할 수 있는 일을 세 가지만 알려 줘',
];

let deps: Deps;
let S: Broadcast;
let root: HTMLElement | null = null;
let refresh: (() => void) | null = null; // updates the live parts of the current step
const picked = new Set<number>();
let task = '';

export function initOnboarding(d: Deps): void {
  deps = d;
}

// Called on every state broadcast. Returns true while setup covers the app.
export function renderOnboarding(state: Broadcast): boolean {
  S = state;
  if (state.settings.onboarded) {
    root?.remove();
    root = null;
    return false;
  }
  if (!root) {
    root = h('div', { class: 'onboarding' });
    document.body.append(root);
    show('welcome');
  } else refresh?.();
  return true;
}

const claudeReady = () => Boolean(S.claude?.loggedIn) || S.settings.providers.some((p) => p.kind !== 'claude' && S.providerKeys.includes(p.id));
const chatgptReady = () => Boolean(S.settings.chatgpt && S.chatgpt?.loggedIn);
const mainBot = () => S.bots.find((b) => b.id === S.settings.mainBotId) || S.bots[0];
const mainConv = (): Conv | undefined => S.convs.find((c) => c.kind === 'dm' && c.botIds[0] === mainBot()?.id);

function show(step: Step): void {
  if (!root) return;
  refresh = null;
  const i = STEPS.indexOf(step);
  const dots = i > 0 ? h('div', { class: 'ob-dots' }, ...STEPS.slice(1).map((_, k) => h('i', { class: k < i ? 'on' : '' }))) : null;
  fill(root, h('div', { class: 'ob-drag' }), h('div', { class: `ob-card ob-${step}` }, dots, ...VIEWS[step]()));
  root.querySelector<HTMLElement>('.ob-card > input, .ob-card > textarea, .ob-actions .btn.primary:not(:disabled)')?.focus();
}

const back = (to: Step) => h('button', { class: 'btn ghost', onclick: () => show(to) }, '뒤로');

const VIEWS: Record<Step, () => Child[]> = {
  welcome: () => [
    h('div', { class: 'ob-cast' }, ...[[0, '#a0673b'], [4, '#ef3b4b'], [1, '#2f7cf6'], [13, '#f26a1b'], [3, '#8b5cf6']].map(([shape, color]) =>
      avatar({ shape: shape as number, color: color as string }, 64, 'idle'))),
    h('h1', null, 'CharacterBot에 오신 것을 환영해요'),
    h('p', { class: 'ob-lede' }, '내 Mac에서 함께 일하는 Bot 팀을 만들어요. 먼저 Bot들이 쓸 AI 계정을 연결할게요.'),
    h('div', { class: 'ob-actions' }, h('button', { class: 'btn primary big', onclick: () => show('accounts') }, '시작하기')),
  ],

  accounts: () => {
    const next = h('button', { class: 'btn primary', onclick: () => show('name') }, '계속');
    const note = h('p', { class: 'ob-note' });
    const claude = accountCard({
      logo: h('img', { src: 'logos/claude.png', alt: '' }),
      title: 'Claude',
      ready: claudeReady,
      status: () => {
        const c = S.claude;
        if (c?.checking) return '확인 중…';
        if (c?.loggedIn) return `${c.email}${c.plan ? ` · ${c.plan}` : ''}`;
        if (claudeReady()) return 'Anthropic API 키';
        return 'Claude Pro·Max 구독으로 로그인하거나 Anthropic API 키를 넣으세요';
      },
      login: async () => {
        toast('브라우저에서 Claude 로그인을 마쳐 주세요');
        await act('connectClaude');
      },
      keyPlaceholder: 'sk-ant-…',
      saveKey: (key) => act('addProvider', { kind: 'anthropic', name: 'Anthropic', key }),
    });
    const chatgpt = accountCard({
      logo: h('span', { class: 'ob-openai' }, icon('openai', 20)),
      title: 'ChatGPT',
      optional: true,
      ready: chatgptReady,
      status: () => {
        const c = S.chatgpt;
        if (c?.checking) return '확인 중…';
        if (chatgptReady()) return c?.plan === 'API' ? 'OpenAI API 키' : `${c?.email || ''}${c?.plan ? ` · ${c.plan}` : ''}`;
        return 'ChatGPT Bot과 이미지 생성에 써요 (선택)';
      },
      login: async () => {
        toast('브라우저에서 ChatGPT 로그인을 마쳐 주세요');
        await act('connectChatgpt');
      },
      keyPlaceholder: 'sk-…',
      saveKey: (key) => act('connectChatgptKey', key),
    });
    refresh = () => {
      claude.update();
      chatgpt.update();
      const ok = claudeReady() || chatgptReady();
      next.disabled = !ok;
      note.textContent = ok ? '이제 로그인되었어요' : '계속하려면 계정을 하나 이상 연결하세요';
      note.classList.toggle('ok', ok);
    };
    refresh();
    return [
      h('h2', null, 'AI 계정 연결'),
      h('p', { class: 'ob-lede' }, '이 Mac의 로그인으로 연결되고, 키는 macOS 키체인으로 암호화해 이 Mac에만 저장해요.'),
      h('div', { class: 'ob-accounts' }, claude.el, chatgpt.el),
      note,
      h('div', { class: 'ob-actions' }, back('welcome'), next),
    ];
  },

  name: () => {
    const field: HTMLInputElement = h('input', { class: 'field', placeholder: '이름', value: S.settings.userName === '나' ? '' : S.settings.userName, maxlength: 40 });
    const go = async () => {
      const name = field.value.trim();
      if (name) await act('updateSettings', { userName: name });
      show('team');
    };
    field.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) go(); };
    return [
      h('h2', null, '어떻게 불러 드릴까요?'),
      h('p', { class: 'ob-lede' }, 'Bot들이 이 이름으로 부르고, 그룹 채팅에서도 이 이름으로 보여요.'),
      field,
      h('div', { class: 'ob-actions' }, back('accounts'), h('button', { class: 'btn primary', onclick: go }, '계속')),
    ];
  },

  team: () => {
    const bot = mainBot();
    const list = h('div', { class: 'ob-team' });
    const draw = () => fill(list,
      h('div', { class: 'ob-pick on fixed' }, bot ? avatar(bot, 36) : null,
        h('div', { class: 'grow' }, h('b', null, bot?.name || 'Octo'), h('span', null, '메인 Bot · 다른 Bot에게 일을 나눠 줘요')), icon('check', 18)),
      ...deps.templates.map((t, i) => h('button', { class: `ob-pick${picked.has(i) ? ' on' : ''}`, onclick: () => { if (picked.has(i)) picked.delete(i); else picked.add(i); draw(); } },
        h('span', { class: 'ob-plus' }, icon(picked.has(i) ? 'check' : 'plus', 16)),
        h('div', { class: 'grow' }, h('b', null, t.name), h('span', null, t.description)))));
    draw();
    return [
      h('h2', null, '함께 일할 Bot을 고르세요'),
      h('p', { class: 'ob-lede' }, '나중에 + 메뉴에서 언제든 더 만들 수 있어요.'),
      list,
      h('div', { class: 'ob-actions' }, back('name'), h('button', { class: 'btn primary', onclick: () => show('task') }, '계속')),
    ];
  },

  task: () => {
    const ta: HTMLTextAreaElement = h('textarea', { class: 'field', rows: 3, placeholder: `${mainBot()?.name || 'Octo'}에게 맡길 일을 적어 보세요`, oninput: () => { task = ta.value; } });
    ta.value = task;
    const send = () => finish(ta.value.trim());
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
    return [
      h('h2', null, 'Bot 팀에 어떤 작업이든 맡겨 보세요'),
      ta,
      h('div', { class: 'ob-chips' }, ...TASKS.map((t) => h('button', { class: 'chip', onclick: () => { ta.value = task = t; ta.focus(); } }, t))),
      h('div', { class: 'ob-actions' }, back('team'), h('button', { class: 'btn ghost', onclick: () => finish('') }, '건너뛰기'), h('button', { class: 'btn primary', onclick: send }, '보내기')),
    ];
  },

  preparing: () => [
    h('div', { class: 'ob-cast' }, ...S.bots.slice(0, 5).map((b) => avatar(b, 48, 'working'))),
    h('h2', null, '팀 준비 중…'),
  ],
};

async function finish(text: string): Promise<void> {
  show('preparing');
  await deps.createTeam([...picked].map((i) => deps.templates[i]));
  await act('finishOnboarding');
  const conv = mainConv();
  if (conv && text) await act('send', conv.id, text);
  if (conv) deps.select(conv.id);
}

// One account row: status, then subscription login or an API key form.
function accountCard(o: {
  logo: Child; title: string; optional?: boolean; ready: () => boolean; status: () => string;
  login: () => Promise<void>; keyPlaceholder: string; saveKey: (key: string) => Promise<unknown>;
}): { el: HTMLElement; update: () => void } {
  const desc = h('div', { class: 'desc' });
  const badge = h('span', { class: 'ob-badge' }, icon('check', 14), '연결됨');
  const key: HTMLInputElement = h('input', { class: 'field', type: 'password', placeholder: o.keyPlaceholder, autocomplete: 'off', spellcheck: false });
  const save = h('button', { class: 'btn primary', onclick: async () => {
    if (!key.value.trim()) return key.focus();
    save.disabled = true;
    const ok = (await o.saveKey(key.value.trim())) !== undefined;
    save.disabled = false;
    if (ok) { key.value = ''; form.hidden = true; }
  } }, '저장');
  const form = h('div', { class: 'ob-key', hidden: true }, key, save);
  key.onkeydown = (e) => { if (e.key === 'Enter') save.click(); };
  const buttons = h('div', { class: 'ob-btns' },
    h('button', { class: 'btn primary', onclick: () => o.login() }, '구독으로 로그인'),
    h('button', { class: 'btn', onclick: () => { form.hidden = !form.hidden; if (!form.hidden) key.focus(); } }, 'API 키'));
  const el = h('div', { class: 'ob-account' },
    h('div', { class: 'ob-row' }, h('span', { class: 'ob-logo' }, o.logo),
      h('div', { class: 'grow' }, h('div', { class: 'label' }, o.title, o.optional ? h('small', null, '선택') : null), desc), badge, buttons),
    form);
  const update = () => {
    const ready = o.ready();
    desc.textContent = o.status();
    badge.hidden = !ready;
    buttons.hidden = ready;
    if (ready) form.hidden = true;
  };
  update();
  return { el, update };
}
