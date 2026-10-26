// Settings modal: a left nav and grouped cards.
import type { Actions } from '../main/main';
import type { Broadcast, Effect, Provider, Settings, Skill } from '../shared/types';
import { h, fill, $, act, icon, editing, openModal, closeModal, userAvatar, toggle, avatar, popover, toast, modelName, modelOptions, type Child } from './ui';
import { LOGOS } from './logos';

type Tab = 'general' | 'computer' | 'usage' | 'update' | 'skills' | 'routines' | 'activity';
type PlanUsage = Awaited<ReturnType<Actions['getUsage']>> | { error: true; available?: undefined; plan?: undefined; fiveHour?: undefined; sevenDay?: undefined; chatgpt?: undefined };
// A provider row; ChatGPT shows here too although it is not a chat provider.
type ProviderView = { id?: string; kind: Provider['kind'] | 'chatgpt'; name?: string; baseUrl?: string };
type ModelItem = { value: string; label: string };
type ModelGroup = { name: string; logo: Child; items: ModelItem[] };

// Four tabs in the nav. Skills, routines and the activity log have no nav entry;
// they open from the command palette, Bot 설정 and 지원.
export const SETTINGS_TABS: [Tab, string, string, boolean?][] = [
  ['general', '일반', 'gear'],
  ['computer', '컴퓨터', 'monitor'],
  ['usage', '사용량 및 청구', 'chart'],
  ['update', '업데이트', 'update'],
  ['skills', '스킬', 'sparkle', true],
  ['routines', '루틴', 'clock', true],
  ['activity', '활동 기록', 'list', true],
];

let S: Broadcast;
let tab: Tab | null = null; // null while closed
let editingSkill: Partial<Skill> | null = null;
let providerForm: 'anthropic' | 'custom' | null = null; // kind of API provider being added
let usage: PlanUsage | null = null; // last fetched plan usage
let host: ReturnType<Actions['hostInfo']> | null = null;
let latestSdk: string | null = null;

export function openSettings(which: Tab = 'general'): void {
  // Open first: replacing an open settings modal runs its close callback (tab = null).
  openModal(h('div', { class: 'modal settings' },
    h('button', { class: 'close', onclick: closeModal }, icon('close', 20)),
    h('nav'),
    h('div', { class: 'content' })), () => { tab = null; });
  tab = which;
  editingSkill = null;
  providerForm = null;
  if (!host) act('hostInfo').then((info) => { host = info ?? null; draw(false); });
  draw(true);
}

export function renderSettings(state: Broadcast): void {
  S = state;
  if (tab && $('#overlay .settings')) draw(false);
}

export const planUsage = () => usage;
export function refreshUsage(onDone?: () => void): void {
  act('getUsage').then((u) => { usage = u || { error: true }; onDone?.(); if (tab) draw(false); });
}

function draw(force: boolean): void {
  const content = $('#overlay .settings .content');
  if (!content) return;
  fill($('#overlay .settings nav'), ...SETTINGS_TABS.filter(([k, , , hidden]) => !hidden || k === tab).map(([k, label, ic]) =>
    h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; editingSkill = null; providerForm = null; draw(true); } }, icon(ic, 17), label)));
  if (!force && editing(content)) return;
  const scroll = content.scrollTop;
  if (!tab) return;
  fill(content, h('h2', {}, SETTINGS_TABS.find(([k]) => k === tab)?.[1]), ...VIEWS[tab]());
  if (!force) content.scrollTop = scroll;
}

const row = (label: string, control: Child, desc: string | null = null) => h('div', { class: 'srow' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, label), desc ? h('div', { class: 'desc' }, desc) : null), control);
const select = <T extends string>(value: T, options: [T, string][], onchange: (v: T) => void) => h('select', { class: 'select', onchange: (e) => onchange(e.target.value as T) },
  options.map(([v, l]) => h('option', { value: v, selected: value === v ? true : null }, l)));
const set = (patch: Partial<Settings>) => act('updateSettings', patch);
const link = (href: string, label: string) => h('a', { class: 'btn soft', href, target: '_blank' }, label, icon('external', 14));
const cap = (s: string | null | undefined) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const TIMEZONES = ['auto', 'Asia/Seoul', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC'];

// ---------- providers (Aside-style "Models" list) ----------

const providerLogo = (p: ProviderView) => {
  if (p.kind === 'chatgpt') return h('span', { class: 'prov-logo' }, icon('openai', 22));
  const src = LOGOS[p.kind === 'claude' ? 'claude' : p.kind === 'anthropic' ? 'anthropic' : ''];
  return h('span', { class: 'prov-logo' }, src ? h('img', { src, width: 24, height: 24, alt: '' }) : icon('cpu', 22));
};

function providerSub(p: ProviderView): string {
  if (p.kind === 'chatgpt') {
    const c = S.chatgpt || { checking: true };
    if (c.checking) return 'Subscription · 확인 중…';
    return c.loggedIn ? `Subscription · ${c.email}${c.plan ? ` · ${cap(c.plan)}` : ''}` : 'Subscription · 로그인 필요';
  }
  if (p.kind === 'claude') {
    const c = S.claude || { checking: true };
    if (c.checking) return 'Subscription · 확인 중…';
    return c.loggedIn ? `Subscription · ${c.email}${c.plan ? ` · ${cap(c.plan)}` : ''}` : 'Subscription · 로그인 필요';
  }
  const where = p.baseUrl ? ` · ${new URL(p.baseUrl).host}` : '';
  return `API${where}${p.id && S.providerKeys.includes(p.id) ? '' : ' · 키 없음'}`;
}

async function useProvider(p: ProviderView): Promise<void> {
  if (p.kind === 'claude' && !S.claude?.loggedIn) {
    toast('브라우저에서 Claude 로그인을 마쳐 주세요');
    if ((await act('connectClaude')) !== undefined) toast('Claude 구독을 연결했어요');
    return;
  }
  if (p.id) act('setProvider', p.id);
}

function providerRow(p: Provider): HTMLElement {
  const active = S.settings.provider === p.id;
  const checking = p.kind === 'claude' && S.claude?.checking;
  const more: HTMLElement = h('button', { class: 'x', title: '더보기', onclick: (e) => { e.stopPropagation(); popover(more, [
    { icon: 'check', label: '기본으로 사용', onclick: () => useProvider(p) },
    ...(p.kind === 'claude' ? [
      { icon: 'update', label: '연결 다시 확인', onclick: () => act('refreshClaude') },
      S.claude?.loggedIn ? { icon: 'logout', label: 'Claude에서 로그아웃', onclick: confirmLogout } : { icon: 'user', label: '로그인', onclick: () => useProvider(p) },
    ] : [{ icon: 'close', label: '연결 해제', class: 'danger', onclick: () => act('removeProvider', p.id) }]),
  ]); } }, icon('more', 18));
  return h('div', { class: 'srow prov', onclick: () => useProvider(p) },
    providerLogo(p),
    h('div', { class: 'grow' }, h('div', { class: 'label' }, p.name), h('div', { class: 'desc' }, providerSub(p))),
    h('span', { class: `ring${checking ? ' spin' : active ? ' on' : ''}`, title: active ? '사용 중' : '이 제공자 사용' }),
    more);
}

const CHATGPT: ProviderView = { id: 'chatgpt', kind: 'chatgpt', name: 'ChatGPT' };

async function connectChatgpt() {
  if (!S.chatgpt?.loggedIn) toast('브라우저에서 ChatGPT 로그인을 마쳐 주세요');
  if ((await act('connectChatgpt')) !== undefined || S.chatgpt?.loggedIn) toast('ChatGPT 구독을 연결했어요');
}

// ChatGPT only generates images, so its ring shows the login rather than the chat provider.
function chatgptRow() {
  const c = S.chatgpt || {};
  const more: HTMLElement = h('button', { class: 'x', title: '더보기', onclick: (e) => { e.stopPropagation(); popover(more, [
    { icon: 'update', label: '연결 다시 확인', onclick: () => act('refreshChatgpt') },
    c.loggedIn ? { icon: 'logout', label: 'ChatGPT에서 로그아웃', onclick: () => act('logoutChatgpt') } : { icon: 'user', label: '로그인', onclick: connectChatgpt },
    { icon: 'close', label: '연결 해제', class: 'danger', onclick: () => act('removeChatgpt') },
  ]); } }, icon('more', 18));
  return h('div', { class: 'srow prov', onclick: () => { if (!c.loggedIn) connectChatgpt(); } },
    providerLogo(CHATGPT),
    h('div', { class: 'grow' }, h('div', { class: 'label' }, 'ChatGPT'), h('div', { class: 'desc' }, providerSub(CHATGPT))),
    h('span', { class: `ring${c.checking ? ' spin' : c.loggedIn ? ' on' : ''}`, title: c.loggedIn ? '연결됨 · 이미지 생성' : '로그인' }),
    more);
}

// Aside-style model menu: search, providers that open a submenu of their models, then extras.
// groups: [{ name, logo, items: [{ value, label }] }]; extras: [{ value, label }].
function modelMenu(anchor: Element, groups: ModelGroup[], extras: ModelItem[], value: string, onPick: (v: string) => void): void {
  document.querySelectorAll('.popover').forEach((x) => x.remove());
  const menu = h('div', { class: 'popover menu picker-menu' });
  const field = h('input', { placeholder: '모델 검색', oninput: () => draw() });
  const list = h('div', {});
  let sub: HTMLElement | null = null;
  const close = () => { menu.remove(); sub?.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e: MouseEvent) => { const t = e.target as Node; if (!menu.contains(t) && !sub?.contains(t)) close(); };
  const pick = (v: string) => { close(); onPick(v); };
  const item = (it: ModelItem) => h('button', { onclick: () => pick(it.value) }, h('span', { class: 'grow ellipsis' }, it.label), it.value === value ? icon('check', 16) : null);
  const openSub = (row: HTMLElement, g: ModelGroup) => {
    sub?.remove();
    const el = h('div', { class: 'popover menu picker-sub' }, g.items.map(item));
    sub = el;
    document.body.append(el);
    const r = row.getBoundingClientRect();
    const left = r.right + 8 + el.offsetWidth > window.innerWidth ? r.left - el.offsetWidth - 8 : r.right + 8;
    el.style.left = `${left}px`;
    el.style.top = `${Math.min(r.top - 6, window.innerHeight - el.offsetHeight - 8)}px`;
    for (const x of list.querySelectorAll('.open')) x.classList.remove('open');
    row.classList.add('open');
  };
  const draw = (): void => {
    const q = field.value.trim().toLowerCase();
    sub?.remove();
    if (q) {
      const hits = groups.flatMap((g) => g.items.filter((it) => `${g.name} ${it.label}`.toLowerCase().includes(q)).map(item));
      return void fill(list, ...(hits.length ? hits : [h('div', { class: 'menu-head' }, '결과 없음')]));
    }
    fill(list, ...groups.map((g) => {
      const row: HTMLElement = h('button', { onmouseenter: () => openSub(row, g), onclick: () => openSub(row, g) }, g.logo, h('span', { class: 'grow' }, g.name), icon('chevron', 14));
      return row;
    }), ...(extras.length ? [h('div', { class: 'sep' }), ...extras.map(item)] : []));
  };
  fill(menu, h('label', { class: 'picker-search' }, icon('search', 16), field), list);
  draw();
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  const below = rect.bottom + 6 + menu.offsetHeight < window.innerHeight;
  menu.style.top = `${below ? rect.bottom + 6 : rect.top - menu.offsetHeight - 6}px`;
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  field.focus();
}

// Picker button: logo + current model + chevron, with an optional "···" segment.
function picker(logo: Child, label: string, open: (anchor: HTMLElement) => void, more?: (anchor: HTMLElement) => void) {
  const btn: HTMLElement = h('button', { class: 'picker-btn', onclick: () => open(btn) }, logo, h('span', { class: 'ellipsis grow' }, label), icon('down', 14));
  const dots: HTMLElement | null = more ? h('button', { class: 'picker-more', title: '더보기', onclick: () => dots && more(dots) }, icon('more', 16)) : null;
  return h('div', { class: 'picker' }, btn, dots);
}

function taskModels() {
  const prov: ProviderView = S.settings.providers.find((p) => p.id === S.settings.provider) || S.settings.providers[0] || { kind: 'claude', name: 'Claude' };
  const small = (p: ProviderView) => h('span', { class: 'picker-logo' }, p.kind === 'chatgpt' ? icon('openai', 16) : LOGOS[p.kind === 'claude' ? 'claude' : p.kind === 'anthropic' ? 'anthropic' : ''] ? h('img', { src: LOGOS[p.kind === 'claude' ? 'claude' : 'anthropic'], width: 16, height: 16, alt: '' }) : icon('cpu', 16));
  // ChatGPT models (value "openai:<slug>") run on the ChatGPT subscription through Codex.
  const options = modelOptions(S.models, `기본값 (${modelName(S.models, '')})`).map(([value, label]) => ({ value, label: value.startsWith('openai:') ? modelName(S.models, value) : label }));
  const chatGroups: ModelGroup[] = [
    { name: prov.name || 'Claude', logo: small(prov), items: options.filter((o) => !o.value.startsWith('openai:')) },
    ...(options.some((o) => o.value.startsWith('openai:')) ? [{ name: 'ChatGPT', logo: small(CHATGPT), items: options.filter((o) => o.value.startsWith('openai:')) }] : []),
  ];
  const chatLabel = S.settings.model ? modelName(S.models, S.settings.model) : `기본값 (${modelName(S.models, '')})`;
  const chatLogo = S.settings.model.startsWith('openai:') ? small(CHATGPT) : small(prov);
  const imageGroups: ModelGroup[] = S.settings.chatgpt ? [{ name: 'ChatGPT', logo: small(CHATGPT), items: [{ value: 'chatgpt', label: 'ChatGPT 이미지 생성' }] }] : [];
  const imageLabel = S.settings.imageModel === 'chatgpt' ? 'ChatGPT 이미지 생성' : '자동';
  return [
    h('h3', {}, '작업 모델'),
    h('div', { class: 'group' },
      row('기본 모델', picker(chatLogo, chatLabel,
        (a) => modelMenu(a, chatGroups, [], S.settings.model, (v) => set({ model: v })),
        (a) => popover(a, [{ icon: 'update', label: '제공자 기본값으로 재설정', onclick: () => set({ model: '' }) }])),
      S.settings.chatgpt ? 'Bot이 대화에 쓰는 모델이에요. ChatGPT 모델은 ChatGPT 구독(Codex)으로 실행돼요. Bot 설정에서 Bot마다 바꿀 수 있어요.' : 'Bot이 대화에 쓰는 모델이에요. Bot 설정에서 Bot마다 바꿀 수 있어요.')),
    h('div', { class: 'group' },
      row('이미지 생성 모델', picker(S.settings.imageModel === 'chatgpt' || S.chatgpt?.loggedIn ? small(CHATGPT) : null, imageLabel,
        (a) => modelMenu(a, imageGroups, [{ value: 'auto', label: '자동' }], S.settings.imageModel, (v) => set({ imageModel: v }))),
      S.settings.chatgpt ? '이미지를 만들고 편집할 때 쓰는 모델이에요. Bot 프로필 아이콘 생성에 쓰여요.' : '이미지를 만들려면 제공자에서 ChatGPT를 연결하세요.')),
  ];
}

function connectMenu(anchor: Element): void {
  const has = (kind: Provider['kind']) => S.settings.providers.some((p) => p.kind === kind);
  popover(anchor, [
    { header: 'Subscription' },
    { icon: 'sparkle', label: 'Claude', hint: has('claude') ? '연결됨' : '', onclick: () => useProvider(S.settings.providers.find((p) => p.kind === 'claude') || { kind: 'claude' }) },
    { icon: 'openai', label: 'ChatGPT', hint: S.settings.chatgpt && S.chatgpt?.loggedIn ? '연결됨' : '', onclick: connectChatgpt },
    { header: 'API' },
    { icon: 'key', label: 'Anthropic', onclick: () => { providerForm = 'anthropic'; draw(true); } },
    '-',
    { icon: 'plus', label: '사용자 지정 제공자 추가', onclick: () => { providerForm = 'custom'; draw(true); } },
  ]);
}

function providerFormView() {
  const custom = providerForm === 'custom';
  const name = h('input', { class: 'field', placeholder: custom ? '이름 (예: 사내 게이트웨이)' : '이름 (선택)' });
  const base = custom ? h('input', { class: 'field', placeholder: 'Base URL (Anthropic 호환, 예: https://gateway.example.com)' }) : null;
  const key = h('input', { class: 'field', type: 'password', placeholder: custom ? 'API 키 또는 토큰' : 'sk-ant-…' });
  setTimeout(() => (base || key).focus());
  return [
    h('p', { class: 'muted small' }, custom ? 'Anthropic Messages API와 호환되는 엔드포인트를 연결해요. 키는 키체인에 암호화되어 저장돼요.' : 'Anthropic 콘솔의 API 키로 사용량만큼 청구돼요. 키는 키체인에 암호화되어 저장돼요.'),
    h('div', { class: 'stack' }, name, base, key),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: async () => {
        if ((await act('addProvider', { kind: providerForm || 'custom', name: name.value.trim(), baseUrl: base?.value.trim(), key: key.value.trim() })) === undefined && !S.settings.providers.some((p) => p.name === (name.value.trim() || 'Anthropic'))) return;
        providerForm = null;
        draw(true);
      } }, '연결'),
      h('button', { class: 'btn', onclick: () => { providerForm = null; draw(true); } }, '취소')),
  ];
}

export function confirmLogout(): void {
  if (!tab) openSettings('general');
  const content = $('#overlay .settings .content');
  fill(content, h('h2', {}, 'Claude에서 로그아웃할까요?'),
    h('p', { class: 'muted' }, '이 앱은 이 컴퓨터의 Claude Code 로그인을 함께 써요. 로그아웃하면 터미널의 Claude Code도 로그아웃돼요.'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn red', onclick: () => act('logoutClaude').then(() => draw(true)) }, '로그아웃'),
      h('button', { class: 'btn', onclick: () => draw(true) }, '취소')));
}

const VIEWS: Record<Tab, () => Child[]> = {
  general() {
    const when = h('input', { class: 'field', placeholder: '예: 내 대신 이메일에 답장해 줘' });
    let effect: Effect = 'allow';
    const label: Record<Effect, string> = { allow: '자동으로 허용', ask: '먼저 묻기', deny: '차단' };
    const claude = S.claude || {};
    return [
      h('h3', {}, '계정'),
      h('div', { class: 'group' }, h('div', { class: 'srow account' },
        userAvatar(S.settings.userName, 46),
        h('div', { class: 'grow' },
          h('input', { class: 'field bare', title: '이름 수정', maxlength: 40, value: S.settings.userName, onchange: (e) => set({ userName: e.target.value.trim() || '나' }) }),
          claude.email ? h('div', { class: 'muted small row', style: 'gap:6px' }, claude.email,
            h('button', { class: 'x', title: '복사', onclick: () => { navigator.clipboard.writeText(claude.email || ''); toast('복사했어요'); } }, icon('copy', 14)))
            : h('div', { class: 'muted small' }, claude.checking ? '확인 중…' : 'Claude 계정이 연결되지 않았어요')),
        h('button', { class: 'btn soft', onclick: (e) => connectMenu(e.currentTarget as Element) }, '계정 추가'),
        claude.loggedIn ? h('button', { class: 'btn soft', onclick: confirmLogout }, '로그아웃')
          : h('button', { class: 'btn soft', onclick: () => useProvider({ kind: 'claude' }) }, '로그인'))),

      ...modelsSection(),

      h('h3', {}, '외관'),
      h('div', { class: 'group' },
        row('테마', select(S.settings.theme, [['system', '시스템 설정 따르기'], ['light', '라이트'], ['dark', '다크']], (v) => set({ theme: v }))),
        row('액센트', select(S.settings.accent, [['bot', 'Bot 색상'], ['default', '기본']], (v) => set({ accent: v }))),
        row('입력하는 동안 맞춤법 검사', toggle(S.settings.spellcheck, (v) => set({ spellcheck: v })))),

      h('h3', {}, '시스템'),
      h('div', { class: 'group' },
        row('하드웨어 가속 사용', toggle(S.settings.hardwareAcceleration, (v) => { set({ hardwareAcceleration: v }); toast('앱을 다시 시작하면 적용돼요'); })),
        row('알림', toggle(S.settings.notifications, (v) => set({ notifications: v })), '앱이 뒤에 있을 때 Bot의 답장을 알림으로 받아요.')),

      h('h3', {}, 'Bot'),
      h('div', { class: 'group' },
        row('시간대', select(S.settings.timezone, TIMEZONES.map((z) => [z, z === 'auto' ? `자동 감지(${host?.timezone || '시스템'})` : z]), (v) => set({ timezone: v }))),
        row('자동 검토', toggle(S.settings.autoReview, (v) => set({ autoReview: v })), 'Bot은 각 작업을 실행하기 전에 확인하고 필요할 때 먼저 물어봐요. 자동으로 실행할 수 있는 작업을 맞춤 설정하려면 규칙을 추가해 주세요.'),
        S.settings.autoReview ? h('div', { class: 'srow', style: 'display:block' },
          h('div', { class: 'label' }, '사용자 지정 규칙'),
          h('div', { class: 'desc' }, '각 작업마다 짧고 자연스러운 언어로 규칙 하나를 작성해 주세요. 규칙이 충돌하면 "먼저 묻기"가 우선해요.'),
          h('div', { class: 'label', style: 'margin:14px 0 6px' }, 'Bot이 다음을 하려고 할 때:'), when,
          h('div', { class: 'label', style: 'margin:12px 0 6px' }, '이렇게 해야 해요:'),
          h('div', { class: 'row' },
            select(effect, Object.entries(label) as [Effect, string][], (v) => { effect = v; }),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn', onclick: () => act('addReviewRule', when.value, effect).then(() => { when.value = ''; }) }, '규칙 추가')),
          h('div', { class: 'desc', style: 'margin-top:12px' }, '이 규칙은 나에게만 적용돼요. 기본 제공 안전 검사는 항상 적용돼요.')) : null,
        ...S.settings.reviewRules.map((r) => h('div', { class: 'rule-row' }, h('span', { class: `badge ${r.effect}` }, label[r.effect]), h('span', { class: 'grow' }, r.when), h('button', { class: 'x', onclick: () => act('deleteReviewRule', r.id) }, '×'))),
        ...S.rules.map((r) => h('div', { class: 'rule-row' }, h('span', { class: `badge ${r.effect}` }, label[r.effect]), h('code', { class: 'grow' }, r.tool || r.match || '', r.botId ? ` · ${S.bots.find((b) => b.id === r.botId)?.name || ''}` : ''), h('button', { class: 'x', onclick: () => act('deleteRule', r.id) }, '×')))),
    ];
  },

  computer() {
    return [
      h('h3', {}, '내 컴퓨터'),
      h('div', { class: 'group' },
        row('이 컴퓨터에서 실행', select(S.settings.computerAccess, [['allow', '항상 허용'], ['ask', '먼저 묻기'], ['deny', '허용 안 함']], (v) => set({ computerAccess: v })),
          'PixelBot이 내 컴퓨터에서 파일을 열고 작업을 실행하도록 해요. 자동 검토는 여전히 먼저 확인해요.'),
        row('내 계정 앱에 쓰기 차단', toggle(S.settings.blockAccountWrites !== false, (v) => set({ blockAccountWrites: v })),
          'Slack, Gmail, 캘린더처럼 내 계정과 연동된 앱에는 읽기만 해요. 보내기·만들기·삭제는 승인 카드 없이 항상 막아요.')),
      ...secretsSection(),
      h('h3', {}, '기기 관리'),
      h('div', { class: 'group' }, h('div', { class: 'srow' }, icon('monitor', 18),
        h('div', { class: 'grow' }, h('div', { class: 'label' }, host?.host || '이 컴퓨터'), h('div', { class: 'desc' }, h('span', { class: 'status connected' }), ' 컴퓨터 · 현재 온라인')))),
      h('h3', {}, 'Bot 컴퓨터'),
      h('div', { class: 'group' },
        row('Bot 컴퓨터 재설정', h('button', { class: 'btn red-soft', onclick: () => confirmReset() }, '재설정'),
          '컴퓨터가 멈추면 새로 시작해 주세요. 모든 Bot의 작업 폴더(라이브러리 파일)가 지워지고 대화 세션이 새로 시작돼요.')),
    ];
  },

  // One card per subscription: plan, then a compact bar per limit window.
  usage() {
    if (!usage) refreshUsage();
    const u = S.usage;
    const meter = (title: string, pct: number | null | undefined, resetsAt: string | number | null | undefined) => {
      const left = resetsAt ? Math.max(0, new Date(resetsAt).getTime() - Date.now()) : 0;
      const when = !resetsAt ? '' : left > 86400000 ? `${Math.ceil(left / 86400000)}일 후 재설정` : `${Math.max(1, Math.round(left / 3600000))}시간 후 재설정`;
      const p = Math.round(pct ?? 0);
      return h('div', { class: 'urow' }, h('span', { class: 'ulabel' }, title), h('div', { class: 'meter' }, h('div', { style: `width:${Math.min(100, p)}%` })),
        h('span', { class: 'upct' }, `${p}%`), h('span', { class: 'muted small uwhen' }, when));
    };
    const card = (logo: Child, name: string, plan: string | null | undefined, manage: string, rows: Child[] | null | undefined, empty: string) => h('div', { class: 'group ucard' },
      h('div', { class: 'uhead' }, logo, h('span', { class: 'grow' }, name, plan ? h('span', { class: 'muted' }, ` · ${cap(plan)}`) : null), manage ? link(manage, '관리') : null),
      rows?.length ? rows : h('div', { class: 'muted small' }, empty));
    const claude = usage?.available
      ? [usage.fiveHour && meter('5시간', usage.fiveHour.utilization, usage.fiveHour.resets_at), usage.sevenDay && meter('주간', usage.sevenDay.utilization, usage.sevenDay.resets_at)].filter(Boolean)
      : null;
    const gpt = usage?.chatgpt?.windows.map((w) => meter(w.title, w.usedPercent, w.resetsAt));
    const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
    return [
      h('div', { style: 'margin-top:18px' }),
      card(h('img', { src: LOGOS.claude, width: 18, height: 18, alt: '' }), 'Claude Code', usage?.plan || S.claude?.plan, 'https://claude.ai/settings/usage', claude,
        usage ? 'Claude 구독으로 로그인되어 있지 않아요' : '불러오는 중…'),
      S.settings.chatgpt ? card(icon('openai', 18), 'Codex', usage?.chatgpt?.plan || S.chatgpt?.plan, 'https://chatgpt.com/codex/settings/usage', gpt,
        usage ? 'ChatGPT 사용량을 불러오지 못했어요' : '불러오는 중…') : null,
      h('div', { class: 'group-note row' }, h('span', { class: 'grow' }, `이 앱 · Bot 턴 ${u.turns.toLocaleString()} · 토큰 입력 ${tokens(u.inputTokens)} / 출력 ${tokens(u.outputTokens)}`),
        h('button', { class: 'btn ghost', onclick: () => { usage = null; draw(true); } }, icon('update', 14), ' 새로고침')),
    ];
  },

  update() {
    const status = latestSdk === null ? null : latestSdk === host?.sdk ? '최신 버전이에요' : `${latestSdk} 사용 가능 · npm update @anthropic-ai/claude-agent-sdk`;
    return [
      h('div', { class: 'group', style: 'margin-top:18px' },
        row('PixelBot', h('span', { class: 'muted' }, host?.version || '')),
        row('Claude Agent SDK', h('button', { class: 'btn soft', onclick: async () => { latestSdk = (await act('checkUpdates')) ?? null; draw(true); } }, '업데이트 확인'), `${host?.sdk || ''}${status ? ` · ${status}` : ''}`),
        row('Electron', h('span', { class: 'muted' }, host?.electron || ''))),
    ];
  },

  skills() {
    if (editingSkill) {
      const s: Partial<Skill> = editingSkill;
      const name = h('input', { class: 'field', value: s.name || '', placeholder: '이름 (예: weekly-report)' });
      const desc = h('input', { class: 'field', value: s.description || '', placeholder: '언제 쓰는지 한 줄 설명' });
      const body = h('textarea', { class: 'field', style: 'min-height:300px', value: s.body || '', placeholder: '단계별 지침을 마크다운으로 적어주세요' });
      return [h('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:16px' }, name, desc, body,
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary', onclick: async () => { if (await act('saveSkill', { id: s.id, name: name.value, description: desc.value, body: body.value })) { editingSkill = null; draw(true); } } }, '스킬 저장'),
          h('button', { class: 'btn', onclick: () => { editingSkill = null; draw(true); } }, '취소')))];
    }
    return [
      h('p', { class: 'muted small' }, '스킬은 Bot이 작업을 일관되게 완료하도록 돕는 반복 가능한 작업 방식이에요. 입력창에서 /이름으로 부르거나 Bot이 필요할 때 스스로 불러와요.'),
      h('div', { class: 'btns', style: 'margin:0 0 14px' }, h('button', { class: 'btn primary', onclick: () => { editingSkill = {}; draw(true); } }, '새 스킬 추가')),
      h('div', { class: 'group' }, S.skills.length ? S.skills.map((s) => h('div', { class: 'srow' },
        icon('sparkle', 17),
        h('div', { class: 'grow' }, h('div', { class: 'label' }, s.name, s.source !== 'user' ? h('span', { class: 'badge', style: 'margin-left:6px' }, S.plugins.find((p) => p.id === s.source)?.name || '플러그인') : null), h('div', { class: 'desc' }, s.description)),
        s.source === 'user' ? h('button', { class: 'btn', onclick: () => { editingSkill = s; draw(true); } }, '편집') : null,
        s.source === 'user' ? h('button', { class: 'x', onclick: () => act('deleteSkill', s.id) }, '×') : null))
        : h('div', { class: 'srow muted' }, '아직 스킬이 없어요')),
    ];
  },

  routines() {
    const bot = (id: string) => S.bots.find((b) => b.id === id);
    const conv = (id: string) => S.convs.find((c) => c.id === id);
    return [
      h('p', { class: 'muted small' }, '루틴은 Bot이 일정에 따라 실행하는 반복 작업이에요. 채팅으로 설정해 달라고 요청하세요. 최소 15분 간격, 최대 20개, 10번 연속 실패하면 자동으로 꺼져요.'),
      h('div', { class: 'group' }, S.routines.length ? S.routines.map((r) => h('div', { class: 'srow' },
        avatar(bot(r.botId), 26),
        h('div', { class: 'grow' }, h('div', { class: 'label' }, r.prompt),
          h('div', { class: 'desc' }, `${S.routineInfo[r.id]?.when || ''} · ${conv(r.convId)?.name || bot(r.botId)?.name || ''} · 마지막 실행 ${r.lastRun ? new Date(r.lastRun).toLocaleString() : '없음'}${r.failures ? ` · 연속 실패 ${r.failures}` : ''}`)),
        toggle(r.enabled, (v) => act('setRoutineEnabled', r.id, v)),
        h('button', { class: 'x', onclick: () => act('deleteRoutine', r.id) }, '×')))
        : h('div', { class: 'srow muted' }, '아직 루틴이 없어요')),
    ];
  },

  activity() {
    const bot = (id: string) => S.bots.find((b) => b.id === id)?.name || '삭제된 Bot';
    return [
      h('div', { class: 'row', style: 'margin:6px 0 12px' }, h('div', { class: 'muted small grow' }, 'Bot이 허용·거부·실패한 모든 작업 (최근 1000건). 시크릿 값은 가려져요.'), h('button', { class: 'btn', onclick: () => act('clearAudit') }, '비우기')),
      h('table', { class: 'audit' },
        h('tr', {}, h('th', {}, '시각'), h('th', {}, 'Bot'), h('th', {}, '작업'), h('th', {}, '결과'), h('th', {}, '입력')),
        [...S.audit].reverse().slice(0, 200).map((a) => h('tr', {},
          h('td', {}, new Date(a.ts).toLocaleString()), h('td', {}, bot(a.botId), a.initiator === 'routine' ? ' ⏰' : ''), h('td', {}, a.tool.replace(/^mcp__characterbot__/, '')),
          h('td', {}, h('span', { class: `badge ${a.outcome}` }, a.outcome)), h('td', { class: 'args' }, JSON.stringify(a.args).slice(0, 300))))),
    ];
  },
};

// 일반 › 모델: providers, then which model does what. The API-key form replaces it while open.
function modelsSection() {
  if (providerForm) return [h('h3', {}, providerForm === 'custom' ? '사용자 지정 제공자' : 'Anthropic API'), ...providerFormView()];
  const add: HTMLElement = h('button', { class: 'srow prov add', onclick: () => connectMenu(add) }, icon('plus', 18), h('span', { class: 'grow' }, '연결'));
  return [
    h('h3', {}, '모델 제공자'),
    h('div', { class: 'group' }, ...S.settings.providers.map(providerRow), S.settings.chatgpt ? chatgptRow() : null, add),
    ...taskModels(),
  ];
}

// 컴퓨터 › 환경 변수 (encrypted secrets the bots' shells and app configs can use).
function secretsSection() {
  const name = h('input', { class: 'field', placeholder: '이름 (예: GITHUB_TOKEN)' });
  const value = h('input', { class: 'field', type: 'password', placeholder: '값' });
  return [
    h('h3', {}, '환경 변수'),
    S.legacySecrets ? h('div', { class: 'group' }, h('div', { class: 'srow' }, icon('key', 16),
      h('span', { class: 'grow' }, S.legacySecrets === 'importing' ? '이전 버전(CharacterBot)의 키와 앱 연결을 가져오는 중이에요. macOS 키체인 창에서 허용을 눌러 주세요.' : '이전 버전(CharacterBot)의 키와 앱 연결을 아직 가져오지 못했어요.'),
      S.legacySecrets === 'failed' ? h('button', { class: 'btn soft', onclick: () => act('retryLegacySecrets').then((ok) => toast(ok ? '가져왔어요' : '가져오지 못했어요. 키체인 창에서 허용을 눌러 주세요')) }, '다시 시도') : null)) : null,
    h('div', { class: 'group' },
      ...S.secretNames.map((n) => h('div', { class: 'srow' }, icon('key', 16), h('code', { class: 'grow' }, n), h('span', { class: 'muted' }, '••••••'), h('button', { class: 'x', onclick: () => act('deleteSecret', n) }, '×'))),
      h('div', { class: 'srow' }, name, value, h('button', { class: 'btn soft', onclick: () => name.value && act('setSecret', name.value.trim(), value.value).then(() => { name.value = ''; value.value = ''; }) }, '추가'))),
    h('div', { class: 'group-note' }, '키체인으로 암호화되고 대화·기록에는 ••••로 가려져요. Bot의 셸에서는 $이름, 앱 설정에서는 ${이름}으로 써요.'),
  ];
}

function confirmReset() {
  const content = $('#overlay .settings .content');
  fill(content, h('h2', {}, 'Bot 컴퓨터를 재설정할까요?'),
    h('p', { class: 'muted' }, '모든 Bot의 작업 폴더에 있는 파일이 영구히 삭제되고, 대화 세션이 새로 시작돼요. 대화 기록은 남아요.'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn red', onclick: () => act('resetComputers').then(() => draw(true)) }, '재설정'),
      h('button', { class: 'btn', onclick: () => draw(true) }, '취소')));
}
