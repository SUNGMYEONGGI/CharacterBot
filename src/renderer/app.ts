import type { FileEntry } from '../main/tools';
import type { ActiveRun, Approval, Bot, Broadcast, Conv, MeetingCard, Message, QuestionCard, Routine, Section, Skill, SkillCard, StreamChunk } from '../shared/types';
import { openSettings, renderSettings, planUsage, refreshUsage, confirmLogout, SETTINGS_TABS } from './settings';
import { openApps, renderApps, serverTile } from './apps';
import {
  h, fill, $, act, icon, avatar, avatarSvg, userAvatar, editing, toast, openModal, closeModal, modalOpen,
  toggle, popover, relativeDay, shapeOf, SHAPE_COUNT, modelName, modelOptions, setAvatarState,
  type Child, type MenuItem,
} from './ui';
import { md, renderDiagrams, openViewer, voiceBubble, toWav16k, blobToDataUrl, clock, parseCsv } from './rich';

let S: Broadcast; // latest state snapshot from the main process
const ui: {
  convId: string | null;
  tab: string;
  attachments: { name: string; dataUrl?: string; text?: string }[];
  skillId: string | null;
  panelOpen: boolean;
  history: { list: string[]; index: number };
  threadId: string | null;
  bundles: Set<string>;
  keepUnread?: string | null;
  suggest?: { list: Suggestion[]; index: number; el: HTMLTextAreaElement } | null;
  threadEls?: { rootId: string; ta: HTMLTextAreaElement; list: HTMLElement; view?: HTMLElement } | null;
  voiceBusy?: boolean;
  tasksBody?: HTMLElement | null;
} = { convId: null, tab: 'details', attachments: [], skillId: null, panelOpen: true, history: { list: [], index: -1 }, threadId: null, bundles: new Set() };

type Suggestion = { label: string; apply: () => void; icon?: string; hint?: string; bot?: Bot; tile?: HTMLElement; status?: string; kind?: string };

const COLORS = ['#111111', '#a0673b', '#ef3b4b', '#f26a1b', '#f7931a', '#20b15a', '#15b8a6', '#2f7cf6', '#8b5cf6', '#ec4899', '#8e8e8e'];
const botById = (id: string | undefined) => S.bots.find((b) => b.id === id);
const conv = () => S.convs.find((c) => c.id === ui.convId);
// The chat views only render while a conversation is selected.
const currentConv = () => conv() as Conv;
const isRunning = (id: string | null | undefined) => Boolean(id && S.runtime.running.includes(id));
const convTitle = (c: Conv) => (c.kind === 'dm' ? botById(c.botIds[0])?.name || 'Bot' : c.name);
const shortTool = (name: string) => name.replace(/^mcp__grokbot__/, '').replace(/^mcp__([^_]+)__/, '$1 · ');

const isMain = (id: string | undefined) => id === (S.settings.mainBotId && botById(S.settings.mainBotId) ? S.settings.mainBotId : S.bots[0]?.id);
// A ★ on the main bot's avatar, as in Grok Bot's sidebar.
const withStar = (el: HTMLElement, botId: string, size: number) => (isMain(botId) ? h('span', { class: 'main-star-wrap', style: `width:${size}px;height:${size}px` }, el, h('span', { class: 'main-star', title: '메인 Bot' }, '★')) : el);

function convAvatar(c: Conv, size: number): HTMLElement {
  if (c.kind === 'dm') return withStar(avatar(botById(c.botIds[0]), size), c.botIds[0], size);
  const small = Math.round(size * 0.56);
  const members = c.botIds.map(botById).filter((b): b is Bot => Boolean(b)).slice(0, 3);
  return h('div', { class: 'cluster', style: `width:${size}px;height:${size}px` }, userAvatar(S.settings.userName, small), members.map((b) => avatar(b, small)));
}

function preview(c: Conv): string {
  const last = [...c.messages].reverse().find((m) => (m.role === 'user' || m.role === 'assistant') && m.content && !m.threadOf);
  if (!last) return '새 대화';
  const who = last.role === 'assistant' && c.kind === 'group' ? `[${botById(last.botId)?.name?.split(' ')[0] || ''}] ` : '';
  return who + last.content.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ');
}

// ---------- sidebar ----------

function renderSidebar() {
  const el = $('#sidebar');
  if (editing(el)) return renderConvList();
  const plus: HTMLElement = h('button', { class: 'circle-btn', title: '새로 만들기', onclick: () => popover(plus, [
    { icon: 'message', label: '새 메시지', onclick: openNewMessage },
    { icon: 'plus', label: '새 Bot 만들기', onclick: openNewBot },
    { icon: 'sparkle', label: 'AI 비서 템플릿', chevron: true, onclick: () => popover(plus, ASSISTANTS.map((t) => ({ label: t.name, hint: t.description, onclick: () => createFromTemplate(t) }))) },
    { icon: 'download', label: '가져오기', chevron: true, onclick: () => popover(plus, [
      { icon: 'download', label: 'Bot 템플릿 가져오기', onclick: async () => select(await act('importBot')) },
      { icon: 'file', label: 'CSV에서 Bot 가져오기', onclick: importBotsCsv },
      { icon: 'list', label: '메모리 가져오기', onclick: () => openMemoryImport() },
    ]) },
  ]) }, icon('plus', 20));
  const busy = S.runtime.running.length + S.runtime.pending.length;
  const tasks = h('button', { class: 'circle-btn tasks-btn', title: '백그라운드 작업', onclick: openTasks }, icon('clock', 19), busy ? h('span', { class: 'count' }, busy) : null);
  const chip: HTMLElement = h('button', { class: 'user-chip', onclick: () => openUserMenu(chip) }, userAvatar(S.settings.userName, 36), h('span', { class: 'ellipsis' }, S.settings.userName));
  fill(el,
    h('div', { class: 'side-top' },
      h('button', { class: 'circle-btn', title: '검색 (⌘K)', onclick: () => openPalette() }, icon('search', 19)),
      tasks, plus),
    h('div', { class: 'conv-list' }),
    h('div', { class: 'side-bottom' }, chip, h('button', { class: 'circle-btn', title: '앱 연결', onclick: () => openApps() }, icon('apps', 19))),
  );
  renderConvList();
}

// Same items as Grok Bot's account menu, minus what this app doesn't have
// (mobile app). Plan row: Claude plan and its weekly use.
function openUserMenu(anchor: Element): void {
  const u = planUsage();
  const pct = u?.available && u.sevenDay ? `${Math.round(u.sevenDay.utilization ?? 0)}% 사용` : '';
  const plan = u?.plan || S.claude?.plan;
  popover(anchor, [
    { icon: 'gauge', label: plan ? `${plan[0].toUpperCase()}${plan.slice(1)}` : '사용량', hint: pct, chevron: true, onclick: () => openSettings('usage') },
    { icon: 'book', label: '지원', chevron: true, onclick: () => popover(anchor, [
      { icon: 'keyboard', label: '키보드 단축키', onclick: openShortcuts },
      { icon: 'list', label: '활동 기록', onclick: () => openSettings('activity') },
      { icon: 'external', label: 'Claude 도움말', onclick: () => window.open('https://support.claude.com') },
    ], { place: 'above' }) },
    { icon: 'gear', label: '설정', onclick: () => openSettings() },
    '-',
    { icon: 'userPlus', label: '계정 추가', onclick: () => openSettings('general') },
    S.claude?.loggedIn ? { icon: 'logout', label: '로그아웃', onclick: confirmLogout } : null,
  ], { place: 'above' });
}

// While a bot works, its chat shows three pulsing dots in the bot's color (as in Grok Bot).
const typingDots = (bot: Bot | undefined, size: number) => h('span', { class: 'typing-dots', style: `width:${size}px;height:${size}px;--dot:${bot?.color || '#999'};--t0:-${Date.now() % 1200}ms` }, h('i'), h('i'), h('i'));

function renderConvList() {
  // Pinned first, then most recent; hidden chats come back when a bot writes.
  // Chats in a section sit under its (collapsible) header, after the loose ones.
  const list = S.convs.filter((c) => !c.hidden || c.id === ui.convId).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  const sections = S.sections || [];
  const inSection = (c: Conv) => sections.some((x) => x.id === c.sectionId);
  fill($('#sidebar .conv-list'),
    ...list.filter((c) => !inSection(c)).map(convRow),
    ...sections.flatMap((sec) => {
      const items = list.filter((c) => c.sectionId === sec.id);
      return [
        h('button', { class: 'section-head', onclick: () => act('updateSection', sec.id, { collapsed: !sec.collapsed }),
          oncontextmenu: (e) => { e.preventDefault(); sectionMenu(e.currentTarget as Element, sec); } },
        h('span', { class: `chev${sec.collapsed ? '' : ' open'}` }, icon('chevron', 12)), h('span', { class: 'grow ellipsis' }, sec.name), h('span', { class: 'muted small' }, items.length || '')),
        ...(sec.collapsed ? [] : items.map(convRow)),
      ];
    }));
}

function sectionMenu(anchor: Element, sec: Section): void {
  popover(anchor, [
    { icon: 'pencil', label: '섹션 이름 변경', onclick: () => askName('섹션 이름 변경', sec.name, (v) => act('updateSection', sec.id, { name: v })) },
    { icon: 'trash', label: '섹션 삭제', class: 'danger', onclick: () => act('deleteSection', sec.id) },
  ]);
}

// Small "name it" dialog (rename bot / group / section, new section).
function askName(title: string, value: string, onSave: (v: string) => void): void {
  const input = h('input', { class: 'field', value });
  const save = () => { const v = input.value.trim(); if (v) onSave(v); closeModal(); };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) save(); };
  openModal(dialog(title, [input], [h('button', { class: 'btn', onclick: closeModal }, '취소'), h('button', { class: 'btn primary', onclick: save }, '저장')]));
  input.focus();
  input.select();
}

function convRow(c: Conv): HTMLElement {
  return h('button', { class: `conv${c.id === ui.convId ? ' active' : ''}${c.unread && c.id !== ui.convId ? ' unread' : ''}`, onclick: () => select(c.id),
    oncontextmenu: (e) => { e.preventDefault(); convMenu(e.currentTarget as Element, c); } },
    isRunning(c.id) ? typingDots(botById(S.runtime.active?.[c.id]?.botId) || botById(c.botIds[0]), 38) : convAvatar(c, 38),
    h('div', { class: 'grow' },
      h('div', { class: 'row' }, h('div', { class: 'name ellipsis grow' }, convTitle(c)), c.pinned ? h('span', { class: 'pin-mark' }, icon('pin', 13)) : null, c.unread && c.id !== ui.convId ? h('span', { class: 'unread-dot' }) : null),
      h('div', { class: 'preview ellipsis' }, preview(c))),
  );
}

// Right-click menu on a sidebar chat (Grok Bot's, minus sections and ID copy).
function convMenu(anchor: Element, c: Conv): void {
  const bot = c.kind === 'dm' ? botById(c.botIds[0]) : null;
  const rename = () => askName(bot ? 'Bot 이름 변경' : '그룹 이름 변경', bot ? bot.name : convTitle(c), (v) => act(bot ? 'updateBot' : 'updateConv', bot ? bot.id : c.id, { name: v }));
  const sections = (S.sections || []).filter((x) => x.id !== c.sectionId);
  const remove = () => {
    if (bot && isMain(bot.id)) return toast('메인 Bot은 삭제할 수 없어요. 먼저 다른 Bot을 메인으로 지정하세요');
    if (bot) confirmThen(`${bot.name}을(를) 삭제할까요?`, '이 Bot과의 대화와 루틴이 지워져요.', () => act('deleteBot', bot.id));
    else confirmThen('그룹 채팅을 삭제할까요?', '대화 기록이 지워져요. Bot들은 그대로 남아요.', () => act('deleteConv', c.id));
  };
  popover(anchor, [
    { icon: 'pin', label: c.pinned ? '고정 해제' : '고정', onclick: () => act('updateConv', c.id, { pinned: !c.pinned }) },
    { icon: 'folder', label: '새 섹션으로 이동', onclick: () => askName('새 섹션', '', (v) => act('createSection', v, c.id)) },
    ...sections.map((x) => ({ icon: 'folder', label: `${x.name}(으)로 이동`, onclick: () => act('updateConv', c.id, { sectionId: x.id }) })),
    c.sectionId ? { icon: 'close', label: '섹션에서 빼기', onclick: () => act('updateConv', c.id, { sectionId: undefined }) } : null,
    { icon: 'bell', label: c.unread ? '읽음으로 표시' : '읽지 않음으로 표시', onclick: () => { if (c.id === ui.convId && !c.unread) ui.keepUnread = c.id; act('updateConv', c.id, { unread: !c.unread }); } },
    '-',
    { icon: 'pencil', label: bot ? 'Bot 이름 변경' : '그룹 이름 변경', onclick: rename },
    bot && !isMain(bot.id) ? { icon: 'star', label: '메인 Bot으로 지정', onclick: () => act('setMainBot', bot.id) } : null,
    '-',
    { icon: 'eyeOff', label: '사이드바에서 숨기기', onclick: () => { act('updateConv', c.id, { hidden: true }); if (c.id === ui.convId) select(recentConvs().find((x) => x.id !== c.id && !x.hidden)?.id); } },
    { icon: 'trash', label: '삭제', class: 'danger', onclick: remove },
  ]);
}
const recentConvs = () => [...S.convs].sort((a, b) => b.updatedAt - a.updatedAt);

// ---------- thread ----------

function stepLabel(m: Message): string {
  const a = (m.args || {}) as Record<string, unknown>;
  const detail = a.command || a.file_path || a.path || a.url || a.query || a.pattern || a.name || a.text || a.question || a.prompt || a.description || '';
  return `${shortTool(m.name || '')}${detail ? ` · ${String(detail).split('\n')[0].slice(0, 90)}` : ''}`;
}

function questionCard(c: Conv, m: Message & { card: QuestionCard }): HTMLElement {
  const { question, options, answer } = m.card;
  // Once answered, only the chosen option stays, its key in the bot's color (as in Grok Bot).
  return h('div', { class: 'card question', style: `--bot:${botById(m.botId)?.color || 'var(--base)'}` }, h('div', { class: 'q' }, question),
    options.map((opt, i) => (answer && answer !== opt ? null : h('button', {
      class: `option${answer === opt ? ' chosen' : ''}`,
      disabled: Boolean(answer) || isRunning(c.id),
      onclick: () => act('answerQuestion', c.id, m.id, opt),
    }, h('span', { class: 'key' }, String.fromCharCode(65 + i)), opt))));
}

function skillCard(c: Conv, m: Message & { card: SkillCard }): HTMLElement {
  const { name, description, body, saved } = m.card;
  return h('div', { class: 'card' },
    h('h4', {}, `새 스킬: ${name}`),
    h('div', { class: 'muted small', style: 'margin:-4px 2px 10px' }, description),
    h('pre', {}, body),
    h('div', { class: 'btns' }, saved ? h('span', { class: 'added' }, icon('check', 14), '저장됨') : h('button', { class: 'btn primary', onclick: () => act('acceptSkill', c.id, m.id) }, '스킬 저장')));
}

// Approvals. Writes to an external app arrive as an editable draft (as in Grok
// Bot); anything else is a plain allow/deny question. Cards are cached so edits
// survive re-renders.
const approvalEls = new Map<string, HTMLElement>(); // approval id -> card
const appOf = (tool: string) => tool.match(/^mcp__(.+?)__(.+)$/);
const appLabel = (server: string) => server.replace(/^claude_ai_/, '').replace(/_/g, ' ');

function approvalCard(p: Approval): HTMLElement {
  const cached = approvalEls.get(p.id);
  if (cached) return cached;
  const bot = botById(p.botId);
  const parts = appOf(p.tool);
  let card: HTMLElement;
  if (!parts || parts[1] === 'grokbot') {
    card = h('div', { class: 'card' },
      h('h4', {}, `${bot?.name}이(가) 이 작업을 하도록 허용할까요?`),
      h('div', { class: 'muted small', style: 'margin:-4px 2px 10px' }, shortTool(p.tool)),
      h('pre', {}, typeof p.args.command === 'string' ? p.args.command : JSON.stringify(p.args, null, 2)),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => act('resolveApproval', p.id, 'allow') }, '한 번만 허용'),
        h('button', { class: 'btn', onclick: () => act('resolveApproval', p.id, 'always') }, '항상 허용'),
        h('button', { class: 'btn ghost danger', onclick: () => act('resolveApproval', p.id, 'deny') }, '거부')));
  } else {
    const fields = Object.entries(p.args).map(([key, v]) => {
      const plain = typeof v === 'string';
      const value = plain ? v : JSON.stringify(v, null, 2);
      const long = !plain || value.length > 60 || value.includes('\n') || /text|body|message|content|description|markdown/i.test(key);
      const input = long ? h('textarea', { class: 'field', rows: Math.min(10, value.split('\n').length + 1), value }) : h('input', { class: 'field', value });
      input.dataset.key = key;
      if (!plain) input.dataset.json = '1';
      return h('label', { class: 'draft-field' }, h('span', { class: 'muted small' }, key), input);
    });
    const send = (decision: 'allow' | 'always') => {
      const args: Record<string, unknown> = {};
      try {
        for (const el of card.querySelectorAll<HTMLInputElement>('[data-key]')) args[el.dataset.key || ''] = el.dataset.json ? JSON.parse(el.value) : el.value;
      } catch {
        return toast('JSON 형식이 올바르지 않아요');
      }
      act('resolveApproval', p.id, decision, args);
    };
    card = h('div', { class: 'card draft' },
      h('div', { class: 'draft-head row' }, avatar(bot, 22),
        h('span', { class: 'grow ellipsis' }, h('b', {}, '초안'), h('span', { class: 'muted' }, ` · ${appLabel(parts[1])} · ${parts[2]}`)),
        h('button', { class: 'circle-btn small', title: '초안 메뉴', onclick: (e) => popover(e.currentTarget as Element, [
          { icon: 'close', label: '이 Bot의 초안 끄기', onclick: () => { act('updateBot', p.botId, { drafts: false }); send('allow'); } },
        ]) }, icon('more', 16))),
      fields,
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => send('allow') }, '보내기'),
        h('button', { class: 'btn', onclick: () => send('always') }, '항상 허용'),
        h('button', { class: 'btn ghost danger', onclick: () => act('resolveApproval', p.id, 'deny') }, '버리기')));
  }
  approvalEls.set(p.id, card);
  return card;
}

// An unrequested meeting invite the bot found: accept / decline / decide later.
function meetingCard(c: Conv, m: Message & { card: MeetingCard }): HTMLElement {
  const bot = botById(m.botId);
  const { title, start, end, organizer, location, answer } = m.card;
  const done = answer ? ({ accept: '수락함', decline: '거절함', later: '나중에 정하기로 함' } as Record<string, string>)[answer] : null;
  const choose = (choice: 'accept' | 'decline' | 'later') => act('answerMeeting', c.id, m.id, choice);
  return h('div', { class: 'card meeting' },
    h('div', { class: 'draft-head row' }, avatar(bot, 22), h('span', { class: 'grow' }, `${bot?.name}이(가) 회의 참여를 요청합니다`)),
    h('div', { class: 'meeting-body row' }, h('span', { class: 'meeting-icon' }, icon('calendar', 20)),
      h('div', { class: 'grow' },
        h('div', { class: 'meeting-title' }, title),
        h('div', { class: 'muted small' }, [start, end].filter(Boolean).join(' – ')),
        organizer ? h('div', { class: 'muted small' }, `주최 · ${organizer}`) : null,
        location ? h('div', { class: 'muted small' }, `장소 · ${location}`) : null)),
    h('div', { class: 'btns' }, done ? h('span', { class: 'added' }, icon('check', 14), done) : [
      h('button', { class: 'btn primary', disabled: isRunning(c.id), onclick: () => choose('accept') }, '수락'),
      h('button', { class: 'btn', disabled: isRunning(c.id), onclick: () => choose('decline') }, '거절'),
      h('button', { class: 'btn ghost', onclick: () => choose('later') }, '나중에')]));
}

// "Slack(으)로 보냄 — “…”" under an approved draft, as in Grok Bot.
function sentLine(m: Message): HTMLElement {
  const parts = appOf(m.name || '') || ['', '', ''];
  const a = (m.args || {}) as Record<string, unknown>;
  const gist = String(a.text || a.message || a.body || a.content || a.title || a.subject || a.summary || '').replace(/\s+/g, ' ').slice(0, 80);
  if (m.content.startsWith('Error')) return h('div', { class: 'sent-line danger' }, `${appLabel(parts[1])}에 보내지 못했어요`);
  return h('div', { class: 'sent-line' }, icon('check', 14), m.content ? `${appLabel(parts[1])}(으)로 보냄${gist ? ` — “${gist}”` : ''}` : '보내는 중…');
}

function toolItem(c: Conv, m: Message): HTMLElement | null {
  const { card } = m;
  if (card?.type === 'question') return questionCard(c, { ...m, card });
  if (card?.type === 'skill') return skillCard(c, { ...m, card });
  if (card?.type === 'meeting') return meetingCard(c, { ...m, card });
  if (m.sent && m.effect !== 'deny') return sentLine(m);
  return null;
}

// Turns "@Bot Name" in rendered text into a colored chip with its avatar.
function decorateMentions(el: HTMLElement, members: Bot[]): HTMLElement {
  if (!members.length) return el;
  const names = members.map((b) => b.name).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${names.join('|')})`, 'g');
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) if (re.test(walker.currentNode.nodeValue || '') && !walker.currentNode.parentElement?.closest('code')) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0;
    const text = node.data;
    for (const match of text.matchAll(re)) {
      const at = match.index;
      frag.append(text.slice(last, at));
      const bot = members.find((b) => b.name === match[1]);
      frag.append(h('span', { class: 'mention', style: `color:${bot?.color}` }, avatar(bot, 16), match[1]));
      last = at + match[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return el;
}

function botBubble(c: Conv, m: Message): HTMLElement {
  const members = m.threadOf ? S.bots : c.botIds.map(botById).filter((b): b is Bot => Boolean(b));
  return decorateMentions(h('div', { class: 'msg bot', 'data-msg': m.id, html: md(m.content) }), members);
}

// Hover bar (quick reactions, more, reply in thread), reactions and the
// "답장 N개" row around one bubble.
const QUICK = ['👍', '❤️', '😂', '🎉', '👀', '✅'];
const MORE_EMOJI = ['🙏', '🔥', '💯', '😮', '😢', '🤔', '👏', '🙌', '💡', '📌', '⏰', '❌'];
function withExtras(c: Conv, m: Message, bubble: HTMLElement, side: 'bot' | 'user', { inThread = false } = {}): HTMLElement {
  const react = (e: string) => act('toggleReaction', c.id, m.id, e);
  const bar = h('div', { class: 'msg-actions' },
    QUICK.slice(0, 3).map((e) => h('button', { class: 'emoji', title: `${e}(으)로 반응`, onclick: () => react(e) }, e)),
    h('button', { title: '반응 추가', onclick: (ev) => emojiPicker(ev.currentTarget as Element, react) }, icon('smile', 16)),
    inThread ? null : h('button', { title: '스레드에서 답장', onclick: () => openThread(m.id) }, icon('thread', 16)));
  const reactions = m.reactions?.length ? h('div', { class: 'reactions' }, m.reactions.map((e) => h('button', { class: 'reaction mine', title: '반응 제거', onclick: () => react(e) }, e, h('span', {}, '1')))) : null;
  const replies = inThread ? [] : c.messages.filter((x) => x.threadOf === m.id && (x.role === 'user' || x.content || x.error));
  const repliers = [...new Set(replies.filter((x) => x.role === 'assistant').map((x) => x.botId))].map((id) => botById(id)).filter((b): b is Bot => Boolean(b));
  const row = replies.length ? h('button', { class: 'replies', onclick: () => openThread(m.id) },
    repliers.slice(0, 3).map((b) => avatar(b, 18)), h('b', {}, `답장 ${replies.length}개`), h('span', { class: 'muted' }, relativeDay(replies[replies.length - 1].ts))) : null;
  return h('div', { class: `msg-wrap ${side}` }, bubble, reactions, row, bar);
}

function emojiPicker(anchor: Element, pick: (emoji: string) => void): void {
  document.querySelectorAll('.popover').forEach((x) => x.remove());
  const rect = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'popover menu emoji-grid' }, h('div', { class: 'menu-head' }, '빠른 반응'),
    h('div', { class: 'grid' }, [...QUICK, ...MORE_EMOJI].map((e) => h('button', { onclick: () => { menu.remove(); pick(e); } }, e))));
  document.body.append(menu);
  menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, rect.top - menu.offsetHeight - 6)}px`;
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('mousedown', off, true); }
  }, true));
}

// Messages another bot sent to this chat (and the replies) fold into one
// "메시지 N개 · [avatar] name" row, as in Grok Bot.
function bundleItem(c: Conv, run: Message[]): HTMLElement {
  const from = botById(run[0].viaBotId);
  const n = run.filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content || m.error)).length;
  const key = run[0].id;
  const open = ui.bundles.has(key);
  return h('div', { class: `bundle${open ? ' open' : ''}` },
    h('button', { class: 'bundle-head', onclick: () => { if (open) ui.bundles.delete(key); else ui.bundles.add(key); renderThread(); } },
      `메시지 ${n}개 · `, avatar(from, 18), h('b', {}, from?.name || 'Bot'), icon(open ? 'down' : 'chevron', 14)),
    open ? h('div', { class: 'bundle-body' }, messageItems(c, run.map(({ viaBotId, ...m }) => m))) : null);
}

// Render items (bubbles, cards, time stamps) for a list of messages.
function messageItems(c: Conv, list: Message[], opts: { inThread?: boolean } = {}): HTMLElement[] {
  const items: HTMLElement[] = [];
  let lastTs = 0;
  let lastSender: string | null | undefined = null;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.ts - lastTs > 30 * 60_000) { items.push(h('div', { class: 'when' }, relativeDay(m.ts))); lastSender = null; }
    lastTs = m.ts;
    if (m.viaBotId) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].viaBotId === m.viaBotId) j++;
      items.push(bundleItem(c, list.slice(i, j + 1)));
      i = j;
      lastSender = null;
      continue;
    }
    // Tool calls stay out of the thread, as in Grok Bot (컴퓨터 tab shows them); only cards appear.
    if (m.role === 'tool') {
      const item = toolItem(c, m);
      if (item) items.push(item);
      continue;
    }
    if (m.role === 'user' && m.fromBotId) {
      const from = botById(m.fromBotId);
      if (lastSender !== m.fromBotId) items.push(h('div', { class: 'sender', style: `color:${from?.color || 'inherit'}` }, from?.name || 'Bot'));
      items.push(h('div', { class: 'grouped' }, avatar(from, 22), withExtras(c, m, h('div', { class: 'msg bot', html: md(m.content) }), 'bot', opts)));
      lastSender = m.fromBotId;
      continue;
    }
    if (m.role === 'user') {
      lastSender = 'user';
      const skill = m.skillId && S.skills.find((s) => s.id === m.skillId);
      if (m.routineId) { items.push(h('div', { class: 'routine-tag' }, icon('clock', 14), m.content.replace(/^⏰ 루틴: /, '루틴 · '))); continue; }
      if (m.attachments?.length) items.push(h('div', { class: 'attach-row' }, m.attachments.map((a) => (a.dataUrl ? h('img', { class: 'thumb', src: a.dataUrl, title: '이미지 전체 화면으로 열기' }) : h('span', { class: 'chip' }, icon('file', 14), a.name)))));
      if (skill) items.push(h('div', { class: 'attach-row' }, h('span', { class: 'chip' }, icon('sparkle', 14), skill.name)));
      items.push(withExtras(c, m, m.voice ? voiceBubble({ ...m, voice: m.voice }) : h('div', { class: 'msg user' }, m.content), 'user', opts));
      continue;
    }
    // assistant
    if (!m.content && !m.error) continue;
    const bot = botById(m.botId);
    const bubble = m.error ? h('div', { class: 'msg error' }, m.error) : withExtras(c, m, botBubble(c, m), 'bot', opts);
    if (c.kind !== 'group' && !(opts.inThread && list.some((x) => x.role === 'assistant' && x.botId !== c.botIds[0]))) { items.push(bubble); lastSender = m.botId; continue; }
    const next = list.slice(i + 1).find((x) => x.role !== 'tool');
    const lastOfRun = !next || next.botId !== m.botId || next.role !== 'assistant';
    if (lastSender !== m.botId) items.push(h('div', { class: 'sender', style: `color:${bot?.color || 'inherit'}` }, bot?.name || 'Bot'));
    items.push(h('div', { class: `grouped${lastOfRun ? '' : ' follow'}` }, lastOfRun ? avatar(bot, 22) : null, bubble));
    lastSender = m.botId;
  }
  return items;
}

const typingBubble = () => h('div', { class: 'typing' }, h('span'), h('span'), h('span'));

// "RO Agent, PR Agent 및 RI Agent 작업 중…": the bot answering now, bots it
// handed work to, then the ones queued after it.
function activityRow(c: Conv): HTMLElement | null {
  const a = S.runtime.active?.[c.id];
  if (!a || a.threadOf) return null;
  const bots = [...new Set([a.botId, ...(a.delegates || []), ...(a.queue || [])])].map(botById).filter((b): b is Bot => Boolean(b));
  if (!bots.length) return null;
  const st = botState(a.botId);
  const verb = st === 'blocked' ? '승인 기다리는 중' : st === 'streaming' && bots.length === 1 ? '입력 중' : '작업 중';
  const names = bots.map((b, i) => h('span', { class: i ? '' : 'lead' }, b.name));
  const joined = names.flatMap((n, i) => (i === 0 ? [n] : [i === names.length - 1 ? ' 및 ' : ', ', n]));
  return h('div', { class: 'activity-row' }, avatar(bots[0], 24), h('span', { class: 'who' }, ...joined, ` ${verb}`, h('span', { class: 'ell' }, h('i', {}, '.'), h('i', {}, '.'), h('i', {}, '.'))));
}

function renderThread() {
  const c = currentConv();
  const thread = $('#chat .thread');
  if (editing(thread)) return; // a draft is being edited
  const stick = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  const main = c.messages.filter((m) => !m.threadOf);
  const running = isRunning(c.id);
  const ids = new Set(S.runtime.pending.map((p) => p.id));
  for (const id of approvalEls.keys()) if (!ids.has(id)) approvalEls.delete(id);
  const pending = S.runtime.pending.filter((p) => p.convId === c.id).map(approvalCard);
  const last = main.at(-1);
  const typing = running && !S.runtime.active?.[c.id]?.threadOf && !pending.length && !(last?.role === 'assistant' && last.content);
  const empty = !c.messages.length && h('div', { class: 'empty' }, convAvatar(c, 72),
    h('div', {}, c.kind === 'group' ? '그룹에 메시지를 보내세요. @이름으로 특정 Bot을 부를 수 있어요.' : `${convTitle(c)}에게 무엇이든 맡겨 보세요`));
  fill(thread, empty, ...messageItems(c, main), ...pending, running ? activityRow(c) : null);
  renderDiagrams(thread);
  if (stick || typing) thread.scrollTop = thread.scrollHeight;
}

// ---------- threads (open in the right panel, beside the main chat) ----------

function openThread(id: string): void {
  ui.threadId = id;
  ui.panelOpen = true;
  render(true);
  ui.threadEls?.ta.focus();
}

function closeThread() {
  ui.threadId = null;
  ui.threadEls = null;
  render(true);
}

// The view is built once per thread so its composer keeps focus and text; only
// the message list is redrawn.
function threadView(c: Conv): HTMLElement | null {
  const root = c.messages.find((m) => m.id === ui.threadId);
  if (!root) { ui.threadId = null; return null; }
  let els = ui.threadEls;
  if (els?.rootId !== root.id) {
    const ta: HTMLTextAreaElement = h('textarea', { rows: 1, placeholder: '스레드에 답장… (@이름으로 다른 Bot 부르기)',
      oninput: () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; sendBtn.classList.toggle('idle', !ta.value.trim()); renderSuggest(ta, ta.parentElement || undefined, true); },
      onkeydown: (e) => { if (suggestKeys(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); reply(); } },
      onblur: hideSuggest });
    const reply = async () => {
      const text = ta.value.trim();
      if (!text || isRunning(c.id)) return text && toast('Bot이 답하는 중이에요. 끝나면 보내 주세요');
      ta.value = '';
      ta.style.height = 'auto';
      sendBtn.classList.add('idle');
      await act('send', c.id, text, [], null, { threadOf: root.id });
    };
    const sendBtn: HTMLElement = h('button', { class: 'round action send idle', title: '보내기', onclick: () => reply() }, icon('send', 18));
    els = ui.threadEls = { rootId: root.id, ta, list: h('div', { class: 'thread-list' }) };
    els.view = h('div', { class: 'thread-view' },
      h('div', { class: 'panel-top' },
        h('span', { class: 'grow thread-title' }, '스레드'),
        h('button', { class: 'circle-btn bordered', title: '스레드 닫기', onclick: closeThread }, icon('close', 18))),
      els.list,
      h('div', { class: 'composer thread-composer' }, ta, sendBtn));
  }
  const replies = c.messages.filter((m) => m.threadOf === root.id);
  const lastReply = replies.at(-1);
  const typing = isRunning(c.id) && S.runtime.active?.[c.id]?.threadOf === root.id && !(lastReply?.role === 'assistant' && lastReply.content);
  const stick = els.list.scrollHeight - els.list.scrollTop - els.list.clientHeight < 80;
  fill(els.list, messageItems(c, [root], { inThread: true }),
    h('div', { class: 'thread-sep' }, h('span', {}, replies.length ? `답장 ${replies.filter((m) => m.role !== 'tool').length}개` : '답장')),
    messageItems(c, replies, { inThread: true }), typing ? typingBubble() : null);
  renderDiagrams(els.list);
  if (stick || typing) els.list.scrollTop = els.list.scrollHeight;
  return els.view || null;
}

function renderChat() {
  const c = currentConv();
  const accent = S.settings.accent === 'bot' ? botById(c.botIds[0])?.color : null;
  document.documentElement.style.setProperty('--accent', accent || '#1f7aec');
  fill($('#chat .chat-top'),
    h('button', { class: 'pill', title: ui.panelOpen ? '세부 정보 닫기' : '세부 정보 열기', onclick: () => { ui.panelOpen = !ui.panelOpen; render(true); } }, convAvatar(c, 24), convTitle(c)));
  const ta = $<HTMLTextAreaElement>('#chat textarea');
  ta.placeholder = c.kind === 'group' ? `${c.name}에게 메시지 보내기` : '답변을 입력하거나 다른 이야기를 하세요';
  ta.spellcheck = S.settings.spellcheck;
  renderThread();
  renderComposerState();
}

// ---------- composer ----------

const input = () => $<HTMLTextAreaElement>('#chat textarea');

function renderComposerState() {
  const running = isRunning(ui.convId);
  const btn = $('#chat .composer .action');
  const idle = !input().value.trim() && !ui.attachments.length && !ui.skillId;
  btn.className = `round action ${running ? 'stop' : `send${idle && !rec ? ' idle' : ''}`}`;
  btn.title = running ? '중지' : rec ? '음성 메모 보내기' : '보내기';
  fill(btn, icon(running ? 'stop' : 'send', running ? 16 : 18));
  $('#chat .composer .mic').classList.toggle('on', Boolean(rec));
  $<HTMLButtonElement>('#chat .composer .mic').disabled = Boolean(rec) || Boolean(ui.voiceBusy);
  $('#chat .composer').classList.toggle('recording', Boolean(rec || ui.voiceBusy));
  const skill = S.skills.find((s) => s.id === ui.skillId);
  if (rec || ui.voiceBusy) {
    const r = rec;
    return fill($('#chat .pending-attach'), h('span', { class: 'chip voice-chip' },
      ui.voiceBusy ? [h('span', { class: 'ring spin small' }), '음성 변환 중…']
        : [h('span', { class: 'rec-dot' }), `음성 메모 녹음 중 · ${clock((Date.now() - (r?.start ?? Date.now())) / 1000)}`, h('button', { class: 'x', title: '녹음 버리기', onclick: discardVoice }, '버리기')]));
  }
  fill($('#chat .pending-attach'),
    skill ? h('span', { class: 'chip' }, icon('sparkle', 13), skill.name, h('button', { class: 'x', onclick: () => { ui.skillId = null; renderComposerState(); } }, '×')) : null,
    ...ui.attachments.map((a, i) => h('span', { class: 'chip' }, icon('file', 13), a.name, h('button', { class: 'x', onclick: () => { ui.attachments.splice(i, 1); renderComposerState(); } }, '×'))));
}

// "/" at the start suggests skills; "@" suggests everyone and members (in a group)
// plus connected apps, as in Grok Bot. In a thread "@" offers every bot: the one
// named joins the thread and answers there.
const APP_STATUS: Record<string, string> = { connected: '연결됨', auth: '인증 필요', error: '오류', connecting: '연결 중' };
function suggestions(el: HTMLTextAreaElement = input(), thread = false): Suggestion[] {
  const before = el.value.slice(0, el.selectionStart);
  const c = currentConv();
  const slash = before.match(/^\/([^\s]*)$/);
  if (slash && !thread) {
    const ids = new Set(c.botIds.flatMap((id) => botById(id)?.skillIds || []));
    return S.skills.filter((s) => ids.has(s.id) && !s.disabled && s.name.toLowerCase().startsWith(slash[1].toLowerCase()))
      .map((s) => ({ label: s.name, icon: 'sparkle', hint: s.description, apply: () => { ui.skillId = s.id; el.value = el.value.slice(before.length); } }));
  }
  const at = before.match(/@([^@\n]*)$/);
  if (at) {
    const q = at[1].toLowerCase();
    const insert = (name: string) => () => { el.value = `${before.slice(0, -at[0].length)}@${name} ${el.value.slice(before.length)}`; };
    const people: Suggestion[] = thread ? S.bots.map((b) => ({ label: b.name, bot: b, kind: 'Bot', apply: insert(b.name) })) : c.kind === 'group' ? [
      { label: '모든 사람', icon: 'at', kind: 'Bot', apply: insert('모든 사람') },
      ...c.botIds.map(botById).filter((b): b is Bot => Boolean(b)).map((b) => ({ label: b.name, bot: b, kind: 'Bot', apply: insert(b.name) })),
    ] : [];
    const apps: Suggestion[] = S.mcpServers.filter((sv) => sv.enabled).map((sv) => ({
      label: sv.name, tile: serverTile(sv, 20), status: APP_STATUS[S.mcpStatus[sv.id]?.status || ''] || '', kind: '플러그인', apply: insert(sv.name),
    }));
    return [...people, ...apps].filter((x) => x.label.toLowerCase().includes(q));
  }
  return [];
}

function renderSuggest(el: HTMLTextAreaElement = input(), anchor: Element = $('#chat .composer'), thread = false): void {
  document.querySelector('.suggest')?.remove();
  const list = suggestions(el, thread);
  ui.suggest = list.length ? { list, index: 0, el } : null;
  if (!list.length) return;
  const rect = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'menu suggest' }, list.map((s, i) => h('button', {
    class: i === 0 ? 'sel' : '',
    onmousedown: (e) => { e.preventDefault(); pick(i); },
  }, s.bot ? avatar(s.bot, 20) : s.tile || icon(s.icon || '', 16),
    h('span', { class: 'grow ellipsis' }, s.label, s.status ? h('span', { class: 'muted small' }, `  ${s.status}`) : null),
    s.hint ? h('span', { class: 'muted small ellipsis', style: 'max-width:200px' }, s.hint) : null,
    s.kind ? h('span', { class: 'muted small' }, s.kind) : null)));
  document.body.append(menu);
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${rect.top - menu.offsetHeight - 8}px`;
}

function pick(i: number): void {
  if (!ui.suggest) return;
  const { el } = ui.suggest;
  ui.suggest.list[i].apply();
  document.querySelector('.suggest')?.remove();
  ui.suggest = null;
  el.focus();
  if (el === input()) renderComposerState();
  else el.parentElement?.querySelector('.action')?.classList.remove('idle');
}

// Arrow keys / Enter / Tab / Esc while the suggestion menu is open. True if handled.
function suggestKeys(e: KeyboardEvent): boolean {
  const { suggest } = ui;
  if (!suggest) return false;
  const max = suggest.list.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggest.index = (suggest.index + (e.key === 'ArrowDown' ? 1 : max - 1)) % max;
    [...(document.querySelector('.suggest')?.children || [])].forEach((b, i) => b.classList.toggle('sel', i === suggest.index));
    return true;
  }
  if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) { e.preventDefault(); pick(suggest.index); return true; }
  if (e.key === 'Escape') { document.querySelector('.suggest')?.remove(); ui.suggest = null; return true; }
  return false;
}
const hideSuggest = () => setTimeout(() => { document.querySelector('.suggest')?.remove(); ui.suggest = null; }, 120);

// ---------- voice memos: record, transcribe on device, send ----------

let rec: { media: MediaRecorder; chunks: Blob[]; start: number; stream: MediaStream; timer: ReturnType<typeof setInterval> } | null = null;
async function startVoice() {
  if (rec || ui.voiceBusy || vc) return;
  if (!(await act('micAccess'))) return toast('마이크 권한이 필요해요. 시스템 설정 › 개인정보 보호 및 보안 › 마이크에서 허용해 주세요');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast('마이크를 시작할 수 없어요');
  }
  const media = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  rec = { media, chunks: [], start: Date.now(), stream, timer: setInterval(renderComposerState, 500) };
  media.ondataavailable = (e) => rec?.chunks.push(e.data);
  media.start(250);
  renderComposerState();
}

function stopVoice(): Promise<{ blob: Blob; duration: number }> {
  const r = rec;
  rec = null;
  if (!r) return Promise.resolve({ blob: new Blob(), duration: 0 });
  clearInterval(r.timer);
  return new Promise((resolve) => {
    r.media.onstop = () => { r.stream.getTracks().forEach((t) => t.stop()); resolve({ blob: new Blob(r.chunks, { type: 'audio/webm' }), duration: (Date.now() - r.start) / 1000 }); };
    r.media.stop();
  });
}

async function discardVoice() {
  if (rec) await stopVoice();
  renderComposerState();
}

async function sendVoice() {
  const convId = ui.convId;
  const { blob, duration } = await stopVoice();
  if (!convId) return;
  if (duration < 0.6) return renderComposerState();
  ui.voiceBusy = true;
  renderComposerState();
  try {
    const text = await act('transcribe', await toWav16k(blob));
    if (text) await act('send', convId, text, [], null, { voice: { dataUrl: await blobToDataUrl(blob), duration } });
  } finally {
    ui.voiceBusy = false;
    renderComposerState();
  }
}

// ---------- voice chat: talk, the bot answers aloud, repeat ----------
// Turn-based: the mic listens until ~1.2 s of silence, the on-device
// transcriber turns it into a message, the reply is spoken with the system
// voice, then it listens again. The mic pauses while the bot speaks (no echo).
type VoiceChat = {
  convId: string;
  stream: MediaStream;
  ctx: AudioContext;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  level: number;
  state: keyof typeof VC_LABEL;
  media: MediaRecorder | null;
  chunks: Blob[];
  voiced: number;
  silentSince: number;
  start: number;
  raf: number;
  after: number;
  sawRunning: boolean;
};
let vc: VoiceChat | null = null;
const VC_LABEL = { listening: '듣는 중', transcribing: '받아 적는 중', thinking: '생각 중', speaking: '말하는 중' };

async function startVoiceChat() {
  if (vc || rec || !ui.convId) return;
  const convId = ui.convId;
  if (!(await act('micAccess'))) return toast('마이크 권한이 필요해요. 시스템 설정 › 개인정보 보호 및 보안 › 마이크에서 허용해 주세요');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    return toast('마이크를 시작할 수 없어요');
  }
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  vc = { convId, stream, ctx, analyser, buf: new Float32Array(1024), level: 0, state: 'listening', media: null, chunks: [], voiced: 0, silentSince: 0, start: Date.now(), raf: 0, after: 0, sawRunning: false };
  vcListen();
}

function stopVoiceChat() {
  if (!vc) return;
  speechSynthesis.cancel();
  cancelAnimationFrame(vc.raf);
  if (vc.media?.state === 'recording') vc.media.stop();
  vc.stream.getTracks().forEach((t) => t.stop());
  vc.ctx.close();
  vc = null;
  renderVoiceChat();
}

function vcListen() {
  const v = vc;
  if (!v) return;
  Object.assign(v, { state: 'listening', chunks: [], voiced: 0, silentSince: 0, start: Date.now() });
  const media = new MediaRecorder(v.stream, { mimeType: 'audio/webm;codecs=opus' });
  v.media = media;
  media.ondataavailable = (e) => v.chunks.push(e.data);
  media.start(250);
  renderVoiceChat();
  const tick = () => {
    if (vc !== v || v.state !== 'listening') return;
    v.analyser.getFloatTimeDomainData(v.buf);
    const rms = Math.sqrt(v.buf.reduce((a, x) => a + x * x, 0) / v.buf.length);
    v.level = Math.min(1, rms * 12);
    const now = Date.now();
    if (rms > 0.02) { v.voiced += 1; v.silentSince = 0; } else if (v.voiced > 8) {
      v.silentSince ||= now;
      if (now - v.silentSince > 1200) return vcFinish(v, media);
    }
    const bar = document.querySelector<HTMLElement>('.voice-chat .level');
    if (bar) bar.style.transform = `scaleX(${0.08 + v.level})`;
    v.raf = requestAnimationFrame(tick);
  };
  tick();
}

async function vcFinish(v: VoiceChat, media: MediaRecorder) {
  v.state = 'transcribing';
  renderVoiceChat();
  const duration = (Date.now() - v.start) / 1000;
  const blob = await new Promise<Blob>((resolve) => { media.onstop = () => resolve(new Blob(v.chunks, { type: 'audio/webm' })); media.stop(); });
  if (vc !== v) return;
  const text = await act('transcribe', await toWav16k(blob)).catch(() => '');
  if (vc !== v) return;
  if (!text?.trim() || isRunning(v.convId)) return vcListen();
  Object.assign(v, { state: 'thinking', after: S.convs.find((c) => c.id === v.convId)?.messages.length || 0, sawRunning: false });
  renderVoiceChat();
  await act('send', v.convId, text, [], null, { voice: { dataUrl: await blobToDataUrl(blob), duration }, voiceChat: true });
}

// Called on every state update: once the reply is in, read it out.
function renderVoiceChat() {
  const el = $('#chat .voice-chat');
  const v = vc;
  if (v?.state === 'thinking') {
    if (isRunning(v.convId)) v.sawRunning = true;
    else if (v.sawRunning) {
      const c = S.convs.find((x) => x.id === v.convId);
      const reply = (c?.messages.slice(v.after) || []).filter((m) => m.role === 'assistant' && !m.threadOf && (m.content || m.error)).map((m) => m.content || '오류가 났어요').join(' ');
      v.state = 'speaking';
      const u = new SpeechSynthesisUtterance(reply.replace(/```[\s\S]*?```/g, ' 코드 생략 ').replace(/[#*`>_|]/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') || '답이 없어요');
      u.lang = 'ko-KR';
      u.voice = speechSynthesis.getVoices().find((x) => x.lang.startsWith('ko')) || null;
      u.onend = () => { if (vc?.state === 'speaking') vcListen(); };
      speechSynthesis.speak(u);
    }
  }
  if (!el) return;
  el.classList.toggle('on', Boolean(v));
  if (!v) return fill(el);
  const bot = botById(S.convs.find((c) => c.id === v.convId)?.botIds[0]);
  fill(el, bot ? avatar(bot, 22) : null,
    h('span', { class: 'grow' }, `음성 채팅 · ${VC_LABEL[v.state]}`, v.convId !== ui.convId ? h('span', { class: 'muted' }, ` (${bot?.name || ''})`) : null),
    v.state === 'listening' ? h('span', { class: 'meter-wrap' }, h('span', { class: 'level' })) : null,
    v.state === 'speaking' ? h('button', { class: 'btn ghost', onclick: () => { speechSynthesis.cancel(); vcListen(); } }, '건너뛰기') : null,
    h('button', { class: 'btn ghost danger', onclick: stopVoiceChat }, '끝내기'));
}

async function submit() {
  const convId = ui.convId;
  if (!convId) return;
  if (isRunning(convId)) return act('stop', convId);
  if (rec) return sendVoice();
  const text = input().value.trim();
  if (!text && !ui.attachments.length && !ui.skillId) return;
  const skill = S.skills.find((s) => s.id === ui.skillId);
  await act('send', convId, text || (skill ? `/${skill.name}` : '첨부 파일을 확인해 주세요'), ui.attachments, ui.skillId);
  input().value = '';
  input().style.height = 'auto';
  ui.attachments = [];
  ui.skillId = null;
  renderComposerState();
}

function buildComposer() {
  const plus: HTMLElement = h('button', { class: 'round plain', title: '추가', onclick: () => popover(plus, [
    { icon: 'clip', label: '파일 첨부', onclick: async () => { ui.attachments.push(...(await act('pickAttachments') || [])); renderComposerState(); } },
    { icon: 'sparkle', label: '스킬 사용', onclick: () => { input().value = '/'; input().focus(); renderSuggest(); } },
  ], { place: 'above' }) }, icon('plus', 18));
  const textarea = h('textarea', {
    rows: 1,
    oninput: (e) => { const el = e.target as unknown as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; renderSuggest(); renderComposerState(); },
    onkeydown: (e) => {
      if (suggestKeys(e)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    },
    onblur: hideSuggest,
  });
  fill($('#chat'),
    h('div', { class: 'chat-top' }),
    h('div', { class: 'thread' }),
    h('div', { class: 'composer-wrap' },
      h('div', { class: 'voice-chat' }),
      h('div', { class: 'pending-attach' }),
      h('div', { class: 'composer' }, plus, textarea,
        h('button', { class: 'round plain', title: '음성 채팅', onclick: startVoiceChat }, icon('wave', 18)),
        h('button', { class: 'round plain mic', title: '음성 메모 녹음', onclick: startVoice }, icon('mic', 18)),
        h('button', { class: 'round action send', onclick: submit }))));
}

// ---------- right panel ----------

function routinesSection(c: Conv): Child[] {
  const url = (r: Routine) => S.routineInfo?.[r.id]?.url || '';
  const list = S.routines.filter((r) => r.convId === c.id);
  if (!list.length) return [h('div', { class: 'hint' }, '루틴은 이 Bot이 일정이나 이벤트(웹훅, 폴더 변경, GitHub PR)에 따라 실행하는 작업입니다. 채팅으로 설정해 달라고 요청해 주세요.')];
  return [
    h('div', { class: 'section-title' }, '루틴'),
    h('div', { class: 'list' }, list.map((r) => h('div', {},
      h('div', { class: 'row' }, h('span', { class: 'grow' }, r.prompt), toggle(r.enabled, (v) => act('setRoutineEnabled', r.id, v))),
      h('div', { class: 'row small muted' },
        h('span', { class: 'grow' }, `${S.routineInfo?.[r.id]?.when || ''}${c.kind === 'group' ? ` · ${botById(r.botId)?.name}` : ''}${r.failures ? ` · 실패 ${r.failures}회` : ''}`, S.routineInfo?.[r.id]?.error ? h('span', { class: 'danger' }, ` · ${S.routineInfo[r.id].error}`) : null),
        url(r) ? h('button', { class: 'btn ghost', title: url(r), onclick: () => { navigator.clipboard.writeText(url(r)); toast('웹훅 주소를 복사했어요'); } }, icon('copy', 14), ' 주소') : null,
        h('button', { class: 'btn ghost', onclick: () => act('runRoutineNow', r.id) }, '지금 실행'),
        h('button', { class: 'x', onclick: () => act('deleteRoutine', r.id) }, '×'))))),
  ];
}

function detailsTab(c: Conv, bot: Bot | null | undefined): Child[] {
  const memories = bot ? [
    h('div', { class: 'section-title' }, `기억${bot.memories.length ? ` ${bot.memories.length}` : ''}`),
    h('div', { class: 'list' },
      // Edit in place: Enter or leaving the field saves, Esc reverts.
      bot.memories.map((m) => h('div', { class: 'row small' },
        h('input', { class: 'field grow memory-text', value: m.text, title: new Date(m.ts).toLocaleString('ko-KR'),
          onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) e.target.blur(); if (e.key === 'Escape') { e.target.value = m.text; e.target.blur(); } },
          onblur: (e) => { const v = e.target.value.trim(); if (!v) e.target.value = m.text; else if (v !== m.text) act('updateMemory', bot.id, m.id, v); } }),
        h('button', { class: 'x', onclick: () => act('deleteMemory', bot.id, m.id) }, '×'))),
      h('button', { class: 'btn ghost', style: 'margin:4px 8px', onclick: () => openMemoryImport(bot) }, icon('download', 14), ' 다른 AI에서 가져오기'),
      h('input', { class: 'field', style: 'border:0;padding:10px 14px', placeholder: '메모리 추가 (Enter)', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim() && !e.isComposing) { act('addMemory', bot.id, e.target.value.trim()); e.target.value = ''; } } })),
  ] : [];
  return [
    ...routinesSection(c),
    ...memories,
    bot ? h('div', { class: 'btns', style: 'justify-content:center;margin-top:20px' }, h('button', { class: 'btn', onclick: () => openConfigure(bot) }, icon('gear', 15), ' Bot 설정')) : null,
  ];
}

// Shown from cache at once, then refreshed in the background (only redrawn on change).
type LibraryFile = FileEntry & { botId: string };
const libraryCache = new Map<string, LibraryFile[]>(); // convId -> files
function libraryTab(c: Conv): Child[] {
  const body = h('div', {});
  const bots = c.botIds.map(botById).filter((b): b is Bot => Boolean(b));
  const draw = (files: LibraryFile[]) => {
    const now = Date.now();
    const bucket = (f: LibraryFile) => (now - f.mtime < 86400000 ? '오늘' : now - f.mtime < 7 * 86400000 ? '이번 주' : '이전');
    const sections = ['오늘', '이번 주', '이전'].map((name): [string, LibraryFile[]] => [name, files.filter((f) => bucket(f) === name)]).filter(([, l]) => l.length);
    fill(body, ...(files.length ? sections.flatMap(([name, list]) => [
      h('div', { class: 'section-title' }, name),
      h('div', { class: 'list' }, list.map((f) => h('button', { class: 'file', onclick: () => viewFile(f.botId, f.path) },
        icon('file', 18), h('span', { class: 'grow ellipsis' }, f.path), bots.length > 1 ? avatar(botById(f.botId), 18) : null))),
    ]) : [h('div', { class: 'hint' }, 'Bot이 만든 파일이 여기에 모여요.')]),
    h('div', { class: 'btns', style: 'justify-content:center' }, bots.length === 1 ? h('button', { class: 'btn ghost', onclick: () => act('revealWorkspace', bots[0].id) }, icon('folder', 15), ' Finder에서 열기') : null));
  };
  const cached = libraryCache.get(c.id);
  if (cached) draw(cached);
  else fill(body, h('div', { class: 'list' }, h('div', { class: 'empty-row' }, '불러오는 중…')));
  Promise.all(bots.map(async (b) => (await act('listFiles', b.id) || []).map((f) => ({ ...f, botId: b.id })))).then((lists) => {
    const files = lists.flat().sort((x, y) => y.mtime - x.mtime);
    if (cached && JSON.stringify(files) === JSON.stringify(cached)) return;
    libraryCache.set(c.id, files);
    draw(files);
  });
  return [body];
}

async function viewFile(botId: string, rel: string) {
  const file = await act('readFile', botId, rel);
  if (file) openViewer(file, () => act('openFile', botId, rel));
}

function computerTab(c: Conv, bot: Bot): Child[] {
  const running = isRunning(c.id);
  const lastTool = [...c.messages].reverse().find((m) => m.role === 'tool' && m.botId === bot.id);
  const screen = running && lastTool
    ? h('div', { class: 'screen' }, h('pre', {}, `$ ${stepLabel(lastTool)}\n\n${(lastTool.content || '실행 중…').slice(-1500)}`))
    : h('div', { class: 'screen' }, h('div', { class: 'zz' }, 'z z'), h('span', { class: 'avatar', html: avatarSvg(0, '#8e8e8e', 34, { sleeping: true }) }), h('div', { style: 'font-weight:500;font-size:14px' }, '컴퓨터가 잠들어 있어요'));
  const entries = S.audit.filter((a) => a.botId === bot.id).slice(-40).reverse();
  return [
    screen,
    h('div', { class: 'caption' }, `${bot.name}의 화면`),
    entries.length ? [h('div', { class: 'section-title' }, '최근 활동'),
      h('div', { class: 'list activity' }, entries.map((a) => h('details', {},
        h('summary', { class: 'row small' }, h('span', { class: `badge ${a.outcome}` }, a.outcome), h('span', { class: 'grow ellipsis' }, stepLabel({ name: a.tool, args: a.args } as Message)), h('span', { class: 'muted' }, new Date(a.ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }))),
        h('pre', {}, a.output))))] : null,
  ];
}

function membersTab(c: Conv): Child[] {
  return [
    h('div', { class: 'list' }, S.bots.map((b) => h('label', { class: 'row' }, avatar(b, 28), h('span', { class: 'grow' }, b.name), toggle(c.botIds.includes(b.id), (v) => {
      const botIds = v ? [...c.botIds, b.id] : c.botIds.filter((x) => x !== b.id);
      if (botIds.length < 2) { toast('그룹에는 Bot이 2개 이상 있어야 해요'); renderPanel(true); return; }
      act('updateConv', c.id, { botIds });
    })))),
    h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn ghost', onclick: openNewBot }, icon('plus', 15), ' 새 Bot 만들기')),
  ];
}

async function renderPanel(force = false) {
  const el = $('#panel');
  document.body.classList.toggle('panel-closed', !ui.panelOpen);
  if (!ui.panelOpen) return;
  const c = currentConv();
  const thread = ui.threadId && threadView(c);
  if (thread) {
    if (el.firstChild !== thread) fill(el, thread);
    return;
  }
  if (!force && editing(el)) return;
  const bot = c.kind === 'dm' ? botById(c.botIds[0]) : null;
  const tabs: [string, string][] = bot ? [['details', '세부 정보'], ['library', '라이브러리'], ['computer', '컴퓨터']] : [['details', '세부 정보'], ['library', '라이브러리'], ['members', '멤버']];
  if (!tabs.some(([k]) => k === ui.tab)) ui.tab = 'details';
  const body = ui.tab === 'library' ? libraryTab(c) : ui.tab === 'computer' && bot ? computerTab(c, bot) : ui.tab === 'members' ? membersTab(c) : detailsTab(c, bot);
  if (!force && editing(el)) return;
  const scroll = el.scrollTop;
  fill(el,
    h('div', { class: 'panel-top' },
      h('button', { class: 'circle-btn bordered', title: '더보기', onclick: (e) => popover(e.currentTarget as Element, [
        ...(bot ? [{ icon: 'gear', label: 'Bot 설정', onclick: () => openConfigure(bot) }] : []),
        { icon: 'list', label: '대화 압축', onclick: () => { act('compactConv', c.id); toast('다음 답장부터 앞선 대화를 요약해서 이어가요'); } },
        { icon: 'close', label: '대화 기록 지우기', onclick: () => confirmThen('대화 기록을 지울까요?', '이 대화의 메시지와 세션이 지워져요.', () => act('clearConv', c.id), '지우기') },
        ...(c.kind === 'group' ? [{ icon: 'close', label: '그룹 삭제', class: 'danger', onclick: () => confirmThen('그룹 채팅을 삭제할까요?', '대화 기록이 지워져요. Bot들은 그대로 남아요.', () => act('deleteConv', c.id)) }] : []),
      ]) }, icon('more', 18)),
      bot ? h('button', { class: 'circle-btn bordered', title: 'Bot 템플릿 내보내기', onclick: () => act('exportBot', bot.id) }, icon('share', 18)) : null,
      h('button', { class: 'circle-btn bordered', title: '닫기', onclick: () => { ui.panelOpen = false; render(true); } }, icon('close', 18))),
    h('div', { class: 'panel-head' },
      bot ? h('button', { title: '아바타 바꾸기', onclick: () => openAvatarEditor(bot) }, avatar(bot, 66)) : convAvatar(c, 66),
      h('input', { class: 'name-input', value: bot ? bot.name : c.name, onchange: (e) => (bot ? act('updateBot', bot.id, { name: e.target.value.trim() || bot.name }) : act('updateConv', c.id, { name: e.target.value.trim() || c.name })) }),
      bot ? h('input', { class: 'label-input', value: bot.label, placeholder: '라벨 추가', onchange: (e) => act('updateBot', bot.id, { label: e.target.value }) }) : null),
    h('div', { class: 'tabs' }, tabs.map(([k, label]) => h('button', { class: `tab${ui.tab === k ? ' active' : ''}`, onclick: () => { ui.tab = k; renderPanel(true); } }, label))),
    h('div', { class: 'panel-body' }, body));
  el.scrollTop = force ? 0 : scroll;
}

// ---------- dialogs ----------

function dialog(title: string, body: Child, foot?: Child, cls = ''): HTMLElement {
  return h('div', { class: `modal dialog ${cls}` },
    h('div', { class: 'dialog-head row' }, h('span', { class: 'grow' }, title), h('button', { class: 'muted', onclick: closeModal }, icon('close', 18))),
    h('div', { class: 'dialog-body' }, body),
    foot ? h('div', { class: 'dialog-foot' }, foot) : null);
}

function confirmThen(title: string, text: string, fn: () => void, label = '삭제'): void {
  openModal(dialog(title, h('div', { class: 'muted' }, text), [
    h('button', { class: 'btn', onclick: closeModal }, '취소'),
    h('button', { class: 'btn red', onclick: () => { closeModal(); fn(); } }, label)]));
}

// Shape + color picker used by "새 Bot 만들기" and the avatar editor.
type Look = { shape: number; color: string; image: string | null };
function avatarPicker(state: Look, onChange?: () => void) {
  const preview = h('span', { class: 'avatar' });
  const shapes = h('div', { class: 'shapes' });
  const colors = h('div', { class: 'colors' });
  const draw = () => {
    preview.innerHTML = avatarSvg(state.shape, state.color, 112);
    fill(shapes, ...Array.from({ length: SHAPE_COUNT }, (_, i) => h('button', { class: `shape-btn${state.shape === i ? ' sel' : ''}`, onclick: () => { state.shape = i; draw(); onChange?.(); }, html: avatarSvg(i, '#9a9a9a', 40) })));
    fill(colors, ...COLORS.map((col) => h('button', { class: `color-btn${state.color === col ? ' sel' : ''}`, style: `background:${col}`, onclick: () => { state.color = col; draw(); onChange?.(); } })));
  };
  draw();
  return { preview, shapes, colors };
}

// Profile: the round character (shape + color) or an AI icon made on ChatGPT
// in Grok Bot Icon Studio style. Returns the dialog body and the look to save.
function profileEditor(state: Look, nameField: HTMLElement | null = null) {
  let mode = state.image ? 'ai' : 'character';
  let busy = false;
  let source: string | null = null; // data URL of the image to reinterpret
  const body = h('div', { class: 'dialog-body creator', style: 'padding:6px 0' });
  const { preview, shapes, colors } = avatarPicker(state);
  const note = h('input', { class: 'field', placeholder: '추가 요청 (선택) · 예: 안경은 유지, 하늘색 머리' });
  const file: HTMLInputElement = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: () => file.files?.[0] && take(file.files[0]) });
  const take = (f: File) => { const r = new FileReader(); r.onload = () => { source = r.result as string; draw(); }; r.readAsDataURL(f); };
  const drop: HTMLElement = h('button', { class: 'drop', onclick: () => file.click(),
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer?.files[0]; if (f?.type.startsWith('image/')) take(f); } });
  const generate = async () => {
    if (!source && !state.image && !note.value.trim()) return toast('변환할 이미지를 올리거나 캐릭터를 설명해 주세요');
    busy = true; draw();
    // Without a new picture, "다시 생성" reworks the current icon (with the extra request, if any).
    const image = await act('generateIcon', { source: source || state.image || undefined, note: note.value.trim() });
    busy = false;
    if (image) state.image = image;
    draw();
  };
  const seg = h('div', { class: 'seg' });
  const draw = (): void => {
    fill(seg, ...[['character', '캐릭터'], ['ai', 'AI 프로필']].map(([k, label]) => h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; draw(); } }, label)));
    if (mode === 'character') return void fill(body, seg, preview, nameField, shapes, colors);
    const ready = S.chatgpt?.loggedIn && S.settings.chatgpt;
    const face = busy ? h('div', { class: 'spin-wrap' }, h('span', { class: 'ring spin' }))
      : state.image ? avatar({ image: state.image }, 112) : h('div', { class: 'spin-wrap muted' }, icon('image', 30));
    fill(drop, source ? h('img', { src: source, alt: '' }) : icon('image', 22),
      h('span', { class: 'grow' }, source ? '이 이미지 속 인물·캐릭터를 아이콘으로 바꿔요. 눌러서 바꾸기' : '사진이나 캐릭터 이미지를 끌어다 놓거나 눌러서 고르세요'));
    fill(body, seg, h('div', { class: 'studio' }, face, nameField,
      ready ? [drop, file, note,
        h('button', { class: 'btn soft', disabled: busy ? true : null, onclick: generate }, icon('sparkle', 15), busy ? ' 생성 중… (1분 정도)' : state.image ? ' 다시 생성' : ' 프로필 생성'),
        h('div', { class: 'muted small' }, 'ChatGPT 구독으로 Grok Bot 아이콘 스타일 이미지를 만들어요.')]
        : [h('div', { class: 'muted small', style: 'text-align:center' }, 'AI 프로필은 ChatGPT 구독으로 만들어요.'),
          h('button', { class: 'btn soft', onclick: () => { closeModal(); openSettings('general'); } }, icon('openai', 15), ' ChatGPT 연결')]));
  };
  draw();
  return { body, look: () => (mode === 'ai' && state.image ? { image: state.image } : { shape: state.shape, color: state.color, image: null }) };
}

// Grok Bot's productivity templates (names and blurbs from its template gallery).
const ASSISTANT_RULES = '당신은 먼저 챙기는(proactive) 비서입니다. 사용자가 요청하지 않은 회의 초대를 발견하면 request_meeting_approval 카드로 참석 여부를 물으세요. 정기 점검 때 사용자가 알아야 할 일을 찾으면 묻기 전에 먼저 알리고, 다음 행동을 제안하세요. 연결된 앱(캘린더, 메일, Slack, Notion 등)을 직접 조회해 사실에 근거해 답하세요. 메일 발송·메시지 전송·삭제처럼 남에게 보이거나 되돌리기 어려운 일은 초안을 먼저 보여주고 승인을 받으세요. 매일 반복할 일은 schedule_routine으로 루틴을 제안하고, 사용자의 선호와 사람·프로젝트 정보는 remember로 기억하세요. 답은 짧고 훑어보기 쉽게 쓰세요.';
const ASSISTANTS = [
  { name: '비서실장', description: 'Slack, 이메일, 캘린더를 살펴보고 확인이 필요한 내용을 요약해요', prompt: '당신은 사용자의 비서실장입니다. Slack, 이메일, 캘린더를 살펴 사용자가 확인하거나 결정해야 할 일을 우선순위대로 정리하고, 놓친 요청과 마감을 짚어 줍니다.',
    routines: [{ daily_time: '09:00', prompt: '오늘 확인하거나 결정해야 할 일을 Slack·메일·캘린더에서 찾아 우선순위대로 알려줘.' }, { every_minutes: 60, prompt: '지난 1시간 동안 나에게 온 요청·멘션·급한 메일이 있으면 알려줘.' }] },
  { name: '일일 브리핑 작성자', description: '나에게 중요한 소식만 추려 간결한 일일 브리핑으로 제공해요', prompt: '당신은 일일 브리핑 작성자입니다. 오늘 일정, 중요한 메일과 메시지, 마감이 다가오는 일을 추려 아침마다 한 화면짜리 브리핑으로 정리합니다.',
    routines: [{ daily_time: '08:00', prompt: '오늘의 일일 브리핑을 작성해줘.' }] },
  { name: '임원 비서', description: '아침 브리핑을 제공하고 새 대화방에 참여하면 놓친 내용을 요약해 줘요', prompt: '당신은 사용자의 임원 비서입니다. 아침 브리핑, 회의 준비 자료, 일정 조율, 후속 조치 정리를 맡고, 대화에 늦게 합류하면 놓친 내용을 요약해 줍니다.',
    routines: [{ daily_time: '08:30', prompt: '아침 브리핑을 해줘.' }, { every_minutes: 30, prompt: '1시간 안에 시작하는 회의가 있으면 준비 자료(참석자, 관련 메일·문서, 안건)를 정리해 알려줘.' }, { every_minutes: 60, prompt: '내가 아직 응답하지 않은 새 회의 초대가 있으면 request_meeting_approval로 참석 여부를 물어봐줘.' }] },
  { name: '받은 편지함 관리자', description: '이메일을 분류하고 긴급 스레드를 표시해 승인용 답장 초안을 작성해요', prompt: '당신은 받은 편지함 관리자입니다. 새 메일을 긴급/답장 필요/참고/무시로 분류하고, 긴급 스레드를 먼저 알려 주며, 답장이 필요한 메일에는 승인용 초안을 작성합니다.',
    routines: [{ every_minutes: 30, prompt: '새 메일을 분류하고, 긴급하거나 답장이 필요한 메일이 있으면 초안과 함께 알려줘.' }] },
];

async function createFromTemplate(t: (typeof ASSISTANTS)[number]) {
  const id = await act('createAssistant', t.name, { shape: Math.floor(Math.random() * SHAPE_COUNT), color: COLORS[Math.floor(Math.random() * COLORS.length)], label: t.description, systemPrompt: `${t.prompt}\n\n${ASSISTANT_RULES}` }, t.routines);
  if (id) { ui.tab = 'details'; select(id); }
}

function openNewBot() {
  const state: Look = { shape: Math.floor(Math.random() * SHAPE_COUNT), color: COLORS[10], image: null };
  const create = h('button', { class: 'btn primary', disabled: true }, '만들기');
  const name: HTMLInputElement = h('input', { class: 'field name', placeholder: 'Bot 이름 입력', oninput: () => { create.disabled = !name.value.trim(); } });
  const { body, look } = profileEditor(state, name);
  create.onclick = async () => {
    const id = await act('createBot', name.value.trim(), look());
    if (id) { closeModal(); ui.tab = 'details'; select(id); }
  };
  openModal(dialog('새 Bot 만들기', body, [h('button', { class: 'btn', onclick: closeModal }, '취소'), create]));
  name.focus();
}

function openAvatarEditor(bot: Bot) {
  const { body, look } = profileEditor({ shape: shapeOf(bot), color: bot.color, image: bot.image || null });
  openModal(dialog('프로필 편집', body, [
    h('button', { class: 'btn', onclick: closeModal }, '취소'),
    h('button', { class: 'btn primary', onclick: () => { act('updateBot', bot.id, look()); closeModal(); } }, '저장')]));
}

// To: one bot opens its chat; two or more start a group (as in OpenBot).
function openNewMessage() {
  const chosen = new Set<string>();
  const name = h('input', { class: 'field', placeholder: '그룹 이름 (선택)' });
  const go = h('button', { class: 'btn primary', disabled: true }, '시작');
  const rows = S.bots.map((b) => h('button', { class: 'pick-row', onclick: (e) => {
    const row = e.currentTarget as HTMLElement;
    if (chosen.has(b.id)) chosen.delete(b.id); else chosen.add(b.id);
    row.classList.toggle('sel', chosen.has(b.id));
    row.querySelector<HTMLElement>('.check')!.style.visibility = chosen.has(b.id) ? 'visible' : 'hidden';
    go.disabled = !chosen.size;
    go.textContent = chosen.size > 1 ? '그룹 채팅 만들기' : '시작';
  } }, avatar(b, 30), h('span', { class: 'grow' }, b.name, b.label ? h('span', { class: 'muted small' }, ` · ${b.label}`) : null), h('span', { class: 'check', style: 'visibility:hidden' }, icon('check', 16))));
  go.onclick = async () => {
    const ids = [...chosen];
    const id = ids.length === 1 ? S.convs.find((c) => c.kind === 'dm' && c.botIds[0] === ids[0])?.id : await act('createGroup', name.value.trim(), ids);
    if (id) { closeModal(); select(id); }
  };
  openModal(dialog('새 메시지', [h('div', { class: 'muted small' }, '받는 사람 — Bot을 2개 이상 고르면 그룹 채팅이 돼요.'), h('div', {}, rows), name], [h('button', { class: 'btn', onclick: closeModal }, '취소'), go]));
}

// ---------- import: bots from CSV, memories from another assistant ----------

// CSV columns (header row, Korean or English): name/이름, role/역할, label/라벨, model/모델.
function importBotsCsv() {
  const file = h('input', { type: 'file', accept: '.csv,.tsv,text/csv' });
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    const [head = [], ...rows] = parseCsv(await f.text(), f.name.endsWith('.tsv') ? '\t' : ',');
    const col = (...names: string[]) => head.findIndex((x) => names.includes(x.trim().toLowerCase()));
    const at = { name: col('name', '이름'), role: col('role', '역할', 'systemprompt', 'system_prompt'), label: col('label', '라벨', '설명'), model: col('model', '모델') };
    if (at.name < 0) return toast('CSV 첫 줄에 name(이름) 열이 있어야 해요');
    const bots = rows.map((r) => ({ name: r[at.name]?.trim(), role: r[at.role]?.trim(), label: r[at.label]?.trim(), model: r[at.model]?.trim() })).filter((b) => b.name).slice(0, 50);
    if (!bots.length) return toast('가져올 Bot이 없어요');
    openModal(dialog(`Bot ${bots.length}개 가져오기`, [
      h('div', { class: 'list' }, bots.map((b) => h('div', { class: 'row small' }, h('b', {}, b.name), h('span', { class: 'muted ellipsis grow' }, b.label || b.role || '')))),
    ], [h('button', { class: 'btn', onclick: closeModal }, '취소'), h('button', { class: 'btn primary', onclick: async () => {
      closeModal();
      toast(`Bot ${await act('importBots', bots)}개를 만들었어요`);
    } }, '가져오기')]));
  };
  file.click();
}

// Grok Bot's memory import: copy a prompt into the other assistant, paste its answer back.
const MEMORY_EXPORT_PROMPT = '지금까지 나에 대해 기억하거나 알고 있는 사실(이름, 직업, 프로젝트, 선호, 자주 쓰는 도구, 진행 중인 일 등)을 빠짐없이 한 줄에 하나씩 "- "로 시작하는 목록으로만 출력해 줘. 설명이나 머리말은 쓰지 마.';
function openMemoryImport(bot: Bot | undefined = botById(conv()?.botIds[0]) || S.bots[0]) {
  const pick = h('select', { class: 'select' }, S.bots.map((b) => h('option', { value: b.id, selected: b.id === bot?.id ? true : null }, b.name)));
  const pasted = h('textarea', { class: 'field', style: 'min-height:150px', placeholder: '다른 AI가 출력한 목록을 여기에 붙여 넣으세요' });
  const lines = () => pasted.value.split('\n').map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.length > 2);
  const go = h('button', { class: 'btn primary', disabled: true }, '메모리에 추가');
  pasted.oninput = () => { const n = lines().length; go.disabled = !n; go.textContent = n ? `메모리 ${n}개 추가` : '메모리에 추가'; };
  go.onclick = async () => { const n = await act('addMemories', pick.value, lines()); closeModal(); toast(`${botById(pick.value)?.name}에 메모리 ${n}개를 추가했어요`); };
  openModal(dialog('메모리 가져오기', [
    h('div', { class: 'muted small' }, '1. 아래 프롬프트를 복사해 ChatGPT·Claude 같은 다른 AI에 보내세요.'),
    h('div', { class: 'row' }, h('div', { class: 'field grow small', style: 'white-space:normal' }, MEMORY_EXPORT_PROMPT),
      h('button', { class: 'btn ghost', onclick: () => { navigator.clipboard.writeText(MEMORY_EXPORT_PROMPT); toast('프롬프트를 복사했어요'); } }, icon('copy', 14), ' 복사')),
    h('div', { class: 'muted small' }, '2. 받은 답을 붙여 넣으세요. 한 줄이 메모리 하나가 돼요.'), pasted,
    h('div', { class: 'row' }, h('span', { class: 'grow' }, '받을 Bot'), pick),
  ], [h('button', { class: 'btn', onclick: closeModal }, '취소'), go]));
}

// ---------- background tasks: what every bot is doing, plus recent runs ----------

const ago = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}초` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}분` : `${Math.round(ms / 3_600_000)}시간`);
function openTasks() {
  ui.tasksBody = h('div', { class: 'tasks' });
  openModal(dialog('백그라운드 작업', [ui.tasksBody], [h('button', { class: 'btn', onclick: closeModal }, '닫기')]), () => { ui.tasksBody = null; });
  renderTasks();
}
function renderTasks() {
  const body = ui.tasksBody;
  if (!body?.isConnected) return;
  const now = Date.now();
  const open = (convId: string) => () => { closeModal(); select(convId); };
  const running = S.runtime.running.map((convId) => {
    const c = S.convs.find((x) => x.id === convId);
    const a: Partial<ActiveRun> = S.runtime.active?.[convId] || {};
    const bots = [a.botId, ...(a.delegates || [])].map(botById).filter((b): b is Bot => Boolean(b));
    const waiting = S.runtime.pending.filter((p) => p.convId === convId);
    const st = waiting.length ? '승인 대기' : a.phase === 'working' ? '도구 실행 중' : '생각 중';
    return h('div', { class: 'task-row' }, bots[0] ? avatar(bots[0], 28) : null,
      h('div', { class: 'grow' }, h('div', {}, bots.map((b) => b.name).join(', ') || 'Bot', h('span', { class: 'muted' }, ` · ${c ? convTitle(c) : ''}${a.threadOf ? ' (스레드)' : ''}`)),
        h('div', { class: 'muted small' }, `${st} · ${ago(now - (S.runtime.started?.[convId] || now))}째`)),
      h('button', { class: 'btn ghost', onclick: open(convId) }, '열기'),
      h('button', { class: 'btn ghost danger', onclick: () => act('stop', convId) }, '중지'));
  });
  const done = (S.runtime.history || []).map((r) => {
    const c = S.convs.find((x) => x.id === r.convId);
    const bots = r.botIds.map(botById).filter((b): b is Bot => Boolean(b));
    return h('div', { class: 'task-row' }, bots[0] ? avatar(bots[0], 28) : null,
      h('div', { class: 'grow' }, h('div', {}, bots.map((b) => b.name).join(', ') || 'Bot', h('span', { class: 'muted' }, ` · ${c ? convTitle(c) : '삭제된 대화'}`)),
        h('div', { class: 'muted small' }, `${r.stopped ? '중지됨' : r.ok ? '완료' : '오류'} · ${ago(r.end - r.start)} 걸림 · ${ago(now - r.end)} 전${r.initiator === 'routine' ? ' · 루틴' : r.initiator === 'bot' ? ' · Bot 요청' : ''}`)),
      c ? h('button', { class: 'btn ghost', onclick: open(r.convId) }, '열기') : null);
  });
  fill(body,
    h('div', { class: 'section-title' }, `실행 중 ${running.length}`), running.length ? running : h('div', { class: 'muted small' }, '지금 실행 중인 작업이 없어요'),
    h('div', { class: 'section-title' }, '최근 작업'), done.length ? done : h('div', { class: 'muted small' }, '이번 실행에서 끝난 작업이 없어요'));
}

// "Bot 설정": role, model, skills and apps for one bot.
function openConfigure(bot: Bot) {
  const prompt = h('textarea', { class: 'field', style: 'min-height:150px', value: bot.systemPrompt });
  const model = h('select', { class: 'select' }, modelOptions(S.models, `기본값 (${modelName(S.models, S.settings.model)})`).map(([v, l]) => h('option', { value: v, selected: bot.model === v ? true : null }, l)));
  const skillIds = new Set(bot.skillIds);
  const serverIds = new Set(bot.serverIds);
  const switchRow = (label: string, set: Set<string>, id: string, extra: Child = null) => h('label', { class: 'row', style: 'padding:6px 2px' }, extra, h('span', { class: 'grow' }, label), toggle(set.has(id), (v) => (v ? set.add(id) : set.delete(id))));
  const skills = S.skills.filter((s) => !s.disabled);
  let drafts = bot.drafts !== false;
  openModal(dialog(`${bot.name} 설정`, [
    h('div', { class: 'label' }, '역할'), h('div', { class: 'muted small' }, '이 Bot이 무엇을 하는지, 어떻게 일해야 하는지 적어주세요.'), prompt,
    h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'grow' }, '모델'), model),
    h('label', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'grow' }, '초안', h('div', { class: 'muted small' }, '메일·메시지처럼 외부 앱에 쓰기 전에 고칠 수 있는 초안을 보여줘요')), toggle(drafts, (v) => { drafts = v; })),
    h('h3', {}, '스킬'), skills.length ? skills.map((s) => switchRow(s.name, skillIds, s.id, icon('sparkle', 15))) : h('div', { class: 'muted small' }, '스킬이 없어요. 설정 › 스킬에서 추가하세요.'),
    h('h3', {}, '앱'), S.mcpServers.length ? S.mcpServers.map((s) => switchRow(s.name, serverIds, s.id, h('span', { class: `status ${S.mcpStatus[s.id]?.status || ''}` }))) : h('div', { class: 'muted small' }, h('button', { class: 'btn ghost', onclick: () => { closeModal(); openApps(); } }, '앱 연결하기')),
    h('div', { class: 'btns', style: 'margin-top:20px' },
      h('button', { class: 'btn ghost', onclick: () => act('exportBot', bot.id) }, icon('share', 15), ' 템플릿 내보내기'),
      isMain(bot.id) ? h('span', { class: 'muted small' }, '★ 메인 Bot · 다른 Bot을 메인으로 지정하면 삭제할 수 있어요')
        : h('button', { class: 'btn ghost', onclick: () => { act('setMainBot', bot.id); closeModal(); toast(`${bot.name}이(가) 메인 Bot이 됐어요`); } }, icon('star', 15), ' 메인 Bot으로 지정'),
      S.bots.length > 1 && !isMain(bot.id) ? h('button', { class: 'btn ghost danger', onclick: () => confirmThen(`${bot.name}을(를) 삭제할까요?`, '이 Bot과의 대화와 루틴이 지워져요.', () => act('deleteBot', bot.id)) }, 'Bot 삭제') : null),
  ], [
    h('button', { class: 'btn', onclick: closeModal }, '취소'),
    h('button', { class: 'btn primary', onclick: () => { act('updateBot', bot.id, { systemPrompt: prompt.value, model: model.value, drafts, skillIds: [...skillIds], serverIds: [...serverIds] }); closeModal(); } }, '저장')]));
}

// ---------- wiring ----------

function select(id: string | null | undefined, remember = true): void {
  if (!id) return;
  if (remember && id !== ui.convId) {
    ui.history.list = [...ui.history.list.slice(0, ui.history.index + 1), id];
    ui.history.index = ui.history.list.length - 1;
  }
  if (id !== ui.convId) { ui.threadId = null; ui.threadEls = null; ui.keepUnread = null; }
  ui.convId = id;
  ui.attachments = [];
  ui.skillId = null;
  if (S.convs.some((c) => c.id === id)) render(true); // a just-created chat renders with the next state
}

function render(force = false) {
  if (!S.convs.some((c) => c.id === ui.convId)) ui.convId = [...S.convs].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
  // Reading the open chat (window focused) marks it read, unless the user just marked it unread.
  const open = S.convs.find((c) => c.id === ui.convId);
  if (open?.unread && ui.keepUnread !== open.id && document.hasFocus()) act('updateConv', open.id, { unread: false });
  document.documentElement.dataset.theme = S.settings.theme === 'system' ? '' : S.settings.theme;
  renderSidebar();
  renderTasks();
  renderVoiceChat();
  renderSettings(S);
  renderApps(S);
  if (!ui.convId) {
    fill($('#chat .thread'), h('div', { class: 'empty' }, '왼쪽 위 + 로 Bot을 만들어 보세요'));
    fill($('#panel'));
    return;
  }
  renderChat();
  renderPanel(force);
}

// Live tokens patch the streaming bubble without rebuilding the thread.
const pendingStream = new Map<string, Message>();
window.desktop.onStream(({ convId, msgId, text }: StreamChunk) => {
  const m = S?.convs.find((c) => c.id === convId)?.messages.find((x) => x.id === msgId);
  if (!m) return;
  m.content += text;
  const botId = m.botId || '';
  streamAt.set(botId, Date.now());
  restyle(botId);
  clearTimeout(streamIdle.get(botId));
  streamIdle.set(botId, setTimeout(() => restyle(botId), 1000));
  if (convId !== ui.convId) return;
  pendingStream.set(msgId, m);
  requestAnimationFrame(() => {
    if (!pendingStream.size) return;
    for (const [id, msg] of pendingStream) {
      const el = document.querySelector(`[data-msg="${id}"]`);
      if (el) el.innerHTML = md(msg.content);
      else if (msg.threadOf) renderPanel();
      else renderThread();
    }
    pendingStream.clear();
    const thread = $('#chat .thread');
    if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160) thread.scrollTop = thread.scrollHeight;
  });
});

// ---------- animated avatars ----------

const streamAt = new Map<string, number>(); // botId -> last streamed text time
const finishedAt = new Map<string, number>(); // botId -> when its run ended
function botState(botId: string): string {
  if (!S) return 'idle';
  for (const convId of S.runtime.running) {
    const a = S.runtime.active?.[convId];
    if (a?.botId !== botId) continue;
    if (S.runtime.pending.some((p) => p.convId === convId && p.botId === botId)) return 'blocked';
    if (Date.now() - (streamAt.get(botId) || 0) < 900) return 'streaming';
    return a.phase || 'thinking';
  }
  return Date.now() - (finishedAt.get(botId) || 0) < 1500 ? 'finished' : 'idle';
}
setAvatarState(botState);
// Updates avatars in place (no re-render) when a bot's state changes between broadcasts.
function restyle(botId: string) {
  const st = botState(botId);
  for (const el of document.querySelectorAll<HTMLElement>(`.avatar[data-bot="${botId}"]`)) {
    if (el.dataset.st === st) continue;
    el.dataset.st = st;
    el.querySelector<HTMLElement>('.av-look')?.style.removeProperty('transform');
  }
}
const streamIdle = new Map<string, ReturnType<typeof setTimeout>>();

window.addEventListener('focus', () => S && render());
window.desktop.onState((state) => {
  const first = !S;
  for (const convId of S?.runtime.running || []) {
    const botId = S.runtime.active?.[convId]?.botId;
    if (botId && !state.runtime.running.includes(convId)) {
      finishedAt.set(botId, Date.now());
      setTimeout(() => restyle(botId), 1600);
    }
  }
  S = state;
  render(first);
});

// Pictures in the chat open full screen.
document.addEventListener('click', (e) => {
  const img = (e.target as Element).closest<HTMLImageElement>('img.thumb, .msg.bot img');
  if (img && !img.closest('.viewer')) openViewer({ kind: 'image', name: img.alt || '이미지', dataUrl: img.src });
});

window.app = { select, getState: () => S };
buildComposer();
window.desktop.init();
refreshUsage();

// ---------- command palette and shortcuts (same keys as Grok Bot) ----------

const SHORTCUTS: [string, string, () => void][] = [
  ['⌘K', '이동 및 명령', () => openPalette()],
  ['⌘N', '새 Bot', () => openNewBot()],
  ['⌘,', '설정', () => openSettings()],
  ['⇧⌘M', '앱 연결', () => openApps()],
  ['⇧⌘W', '스킬', () => openSettings('skills')],
  ['⇧⌘F', 'Bot 검색', () => openPalette()],
  ['⌘I', '입력창으로 이동', () => input().focus()],
  ['⌘B', '사이드바 열기/닫기', () => document.body.classList.toggle('sidebar-closed')],
  ['⌥↑', '이전 Bot', () => step(-1)],
  ['⌥↓', '다음 Bot', () => step(1)],
  ['⌘[', '뒤로', () => travel(-1)],
  ['⌘]', '앞으로', () => travel(1)],
];
const KEYMAP: Record<string, string> = { k: '⌘K', n: '⌘N', ',': '⌘,', 'shift+m': '⇧⌘M', 'shift+w': '⇧⌘W', 'shift+f': '⇧⌘F', i: '⌘I', b: '⌘B', '[': '⌘[', ']': '⌘]' };

function step(dir: number) {
  const list = [...S.convs].sort((a, b) => b.updatedAt - a.updatedAt);
  const i = list.findIndex((c) => c.id === ui.convId);
  select(list[(i + dir + list.length) % list.length]?.id);
}

function travel(dir: number) {
  const i = ui.history.index + dir;
  if (i < 0 || i >= ui.history.list.length) return;
  ui.history.index = i;
  select(ui.history.list[i], false);
}

function openShortcuts() {
  openModal(dialog('키보드 단축키', SHORTCUTS.map(([k, label]) => h('div', { class: 'shortcut-row' }, label, h('span', { class: 'kbd' }, k)))));
}

function openPalette() {
  const c = conv();
  const settingsTabs = SETTINGS_TABS.map(([k, label, ic]) => ({ icon: ic, label: `설정: ${label}`, sub: '설정', run: () => openSettings(k) }));
  type PaletteItem = { label: string; run: () => void; icon?: string; sub?: string; key?: string; conv?: Conv };
  const commands: PaletteItem[] = [
    { icon: 'plus', label: '새 Bot', run: openNewBot },
    { icon: 'users', label: '그룹 채팅 만들기', run: openNewMessage },
    { icon: 'keyboard', label: '키보드 단축키', sub: '도움말', run: openShortcuts },
    ...(c?.kind === 'group' ? [{ icon: 'users', label: '멤버', sub: '현재 채팅', run: () => { ui.panelOpen = true; ui.tab = 'members'; render(true); } }] : []),
    { icon: 'apps', label: '앱 연결', key: '⇧⌘M', run: () => openApps() },
    ...([['system', '시스템 설정 따르기'], ['light', '라이트 모드'], ['dark', '다크 모드']] as const).map(([v, label]) => ({
      icon: v === 'dark' ? 'moon' : v === 'light' ? 'sun' : 'monitor', label: `테마: ${label}`, sub: S.settings.theme === v ? '사용 중' : '외관', run: () => act('updateSettings', { theme: v }) })),
    ...settingsTabs,
  ];
  const subtitle = (x: Conv) => {
    if (x.kind === 'group') return x.botIds.map(botById).filter((b): b is Bot => Boolean(b)).map((b) => b.name).join(', ') || '그룹 채팅';
    const b = botById(x.botIds[0]);
    return b?.systemPrompt?.trim().split('\n')[0] || 'Bot';
  };
  const chats: PaletteItem[] = [...S.convs].sort((a, b) => b.updatedAt - a.updatedAt).map((x) => ({ conv: x, label: convTitle(x), sub: subtitle(x), run: () => select(x.id) }));
  let sel = 0;
  let shown: PaletteItem[] = [];
  const list = h('div', { class: 'pal-list' });
  const field = h('input', { placeholder: '검색', oninput: () => { sel = 0; draw(); } });
  const run = (item: PaletteItem) => { closeModal(); item.run(); };
  const draw = () => {
    const q = field.value.trim().toLowerCase();
    shown = [...chats, ...commands].filter((it) => !q || `${it.label} ${it.sub || ''}`.toLowerCase().includes(q));
    fill(list, ...shown.map((it, i) => h('button', { class: `pal-item${i === sel ? ' sel' : ''}`, onmousemove: () => { if (sel !== i) { sel = i; draw(); } }, onclick: () => run(it) },
      it.conv ? convAvatar(it.conv, 32) : h('span', { class: 'ic' }, icon(it.icon || '', 17)),
      h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, it.label), it.sub ? h('div', { class: 'sub ellipsis' }, it.sub) : null),
      i < 9 ? h('span', { class: 'pal-key' }, `⌘${i + 1}`) : it.key ? h('span', { class: 'pal-key' }, it.key) : null)));
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  };
  field.onkeydown = (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; draw(); }
    if (e.key === 'Enter' && shown[sel]) run(shown[sel]);
    if (e.metaKey && /^[1-9]$/.test(e.key) && shown[Number(e.key) - 1]) { e.preventDefault(); run(shown[Number(e.key) - 1]); }
  };
  openModal(h('div', { class: 'modal palette' }, h('label', { class: 'pal-search' }, icon('search', 17), field), list));
  draw();
  field.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOpen()) return closeModal();
  if (e.altKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); return step(e.key === 'ArrowUp' ? -1 : 1); }
  if (!e.metaKey || e.isComposing) return;
  const combo = KEYMAP[`${e.shiftKey ? 'shift+' : ''}${e.key.toLowerCase()}`];
  const entry = SHORTCUTS.find(([k]) => k === combo);
  if (!entry) return;
  e.preventDefault();
  if (modalOpen() && combo !== '⌘K') closeModal();
  if (combo === '⌘K' && modalOpen()) return closeModal();
  entry[2]();
});
