import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Notification, nativeTheme, nativeImage, systemPreferences } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as store from './store';
import * as agent from './agent';
import * as mcp from './mcp';
import * as tools from './tools';
import * as gateway from './gateway';
import * as routines from './routines';
import * as triggers from './triggers';
import * as plugins from './plugins';
import * as oauth from './oauth';
import * as providers from './providers';
import * as rename from './rename';
import * as imagegen from './imagegen';
import { pendingPrompt, mentionedBots } from './transcript';
import os from 'node:os';
import type { SandboxMode, ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  ActiveRun, Approval, Attachment, Bot, Conv, Effect, Initiator, LoginStatus, McpServer, Message, ModelInfo,
  Provider, Routine, Rule, RunRecord, Section, Settings, Skill, State,
} from '../shared/types';
import type { Call } from './gateway';
import type { ClaudeUsage, GateResult } from './agent';
import type { Secrets } from './mcp';
import type { OauthClient, OauthRecord } from './oauth';
import type { ScheduleInput } from './routines';
import type { ToolCtx } from './tools';
import type { Prompt } from './transcript';

// The app's own entries in secrets.bin sit beside the user's ${NAME} secrets.
interface SecretStore {
  [name: string]: unknown;
  __oauth?: Record<string, OauthRecord>;
  __google_client?: { client_id: string; client_secret?: string };
}
type Tag = { threadOf?: string; viaBotId?: string };
type ApprovalDone = (decision: 'allow' | 'deny' | 'always', args?: Record<string, unknown>) => void;

// `npm start` keeps its data apart from the installed app, so a fresh install
// starts at first-run setup instead of showing development chats. A v0.1.x
// CharacterBot folder moves over on first launch.
{
  const suffix = app.isPackaged ? '' : ' Dev';
  const dir = path.join(app.getPath('appData'), `PixelBot${suffix}`);
  rename.moveDataDir(path.join(app.getPath('appData'), `${rename.LEGACY_NAME}${suffix}`), dir);
  app.setPath('userData', dir);
}

// Takes effect on the next launch (settings › 일반 › 시스템).
if (store.load(path.join(app.getPath('userData'), 'state.json')).settings.hardwareAcceleration === false) app.disableHardwareAcceleration();

// Apps launched from Finder get a bare PATH; borrow the login shell's so
// `npx`-based MCP servers and shell commands resolve.
if (process.platform !== 'win32') {
  try {
    process.env.PATH = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 5000 }) || process.env.PATH;
  } catch {}
}

const dataDir = () => app.getPath('userData');
const stateFile = () => path.join(dataDir(), 'state.json');
const secretsFile = () => path.join(dataDir(), 'secrets.bin');
const workspace = (botId: string): string => {
  const dir = path.join(dataDir(), 'workspaces', botId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

let win: BrowserWindow | null = null;
let state: State;
// running: convId -> AbortController; active: who is answering where; history: finished runs (작업 목록)
const runtime = {
  pending: [] as Approval[],
  running: new Map<string, AbortController>(),
  active: {} as Record<string, ActiveRun>,
  started: {} as Record<string, number>,
  history: [] as RunRecord[],
};
const approvals = new Map<string, ApprovalDone>(); // approval id -> resolve
const grants = new Map<string, number>(); // botId -> one-shot calendar replies the user okayed on a meeting card

// ---------- persistence & broadcast ----------

let saveTimer: NodeJS.Timeout | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.save(stateFile(), state), 400);
}

let broadcastTimer: NodeJS.Timeout | undefined;
function broadcast() {
  persist();
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    // Dock badge: approvals plus question/meeting cards still waiting on the user.
    const waiting = runtime.pending.length + state.convs.reduce((n, c) => n + c.messages.filter((m) => (m.card?.type === 'question' || m.card?.type === 'meeting') && m.card.answer == null).length, 0);
    app.dock?.setBadge(waiting ? String(waiting) : '');
    const secrets = readSecrets();
    const w = win;
    w.webContents.send('state', {
      ...state,
      routineInfo: Object.fromEntries(state.routines.map((r) => [r.id, {
        when: routines.describe(r.schedule), url: r.schedule.type === 'webhook' ? triggers.webhookUrl(r.schedule.key) : null, error: triggers.status(r),
      }])),
      runtime: { pending: runtime.pending, running: [...runtime.running.keys()], active: runtime.active, started: runtime.started, history: runtime.history },
      mcpStatus: mcp.status(),
      secretNames: Object.keys(userSecretsFrom(secrets)),
      oauthConnected: Object.entries(secrets.__oauth || {}).filter(([, rec]) => rec.tokens).map(([id]) => id),
      hasGoogleClient: Boolean(secrets.__google_client),
      providerKeys: state.settings.providers.filter((p) => secrets[`__provider_${p.id}`]).map((p) => p.id),
      claude: claudeStatus,
      chatgpt: chatgptStatus,
      oauthRedirect: oauth.REDIRECT_URI,
      models: [...models, ...openaiModels],
    });
  }, 30);
}

// ---------- secrets (encrypted with the OS keychain) ----------

let legacyTried = false;
function readSecrets(): SecretStore {
  let blob: Buffer;
  try {
    blob = fs.readFileSync(secretsFile());
  } catch {
    return {};
  }
  try {
    return JSON.parse(safeStorage.decryptString(blob));
  } catch {}
  // Written by CharacterBot (v0.1.x) under its own Keychain item: re-encrypt once.
  // Asked at most once per launch; a declined prompt keeps a copy of the old file.
  if (legacyTried) return {};
  legacyTried = true;
  const legacy = rename.decryptLegacy(blob);
  if (!legacy) {
    fs.copyFileSync(secretsFile(), `${secretsFile()}.${rename.LEGACY_NAME}`);
    return {};
  }
  try {
    const secrets = JSON.parse(legacy) as SecretStore;
    if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(secretsFile(), safeStorage.encryptString(legacy));
    return secrets;
  } catch {
    return {};
  }
}

function writeSecrets(secrets: SecretStore): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS 암호화 저장소를 사용할 수 없습니다');
  fs.writeFileSync(secretsFile(), safeStorage.encryptString(JSON.stringify(secrets)));
  syncMcp();
  broadcast();
}

// Keys starting with "__" are the app's own (OAuth tokens, provider keys).
const userSecretsFrom = (secrets: SecretStore): Secrets =>
  Object.fromEntries(Object.entries(secrets).filter((e): e is [string, string] => !e[0].startsWith('__') && typeof e[1] === 'string'));
const providerKey = (secrets: SecretStore, id: string | undefined): string | undefined => {
  const v = secrets[`__provider_${id}`];
  return typeof v === 'string' ? v : undefined;
};

// ---------- OAuth sign-in for remote apps ----------

const oauthRecord = (secrets: SecretStore, id: string): OauthRecord => ({ ...secrets.__oauth?.[id] });
const saveOauth = (id: string, rec: OauthRecord) => () => {
  const secrets = readSecrets();
  writeSecrets({ ...secrets, __oauth: { ...secrets.__oauth, [id]: rec } });
};
// Google servers use the OAuth client the user created; the rest register themselves.
const oauthClient = (server: McpServer, secrets: SecretStore): OauthClient => (server.oauth?.provider === 'google' ? secrets.__google_client ?? null
  : server.oauth?.clientId ? { client_id: server.oauth.clientId, client_secret: server.oauth.clientSecret } : null);

// server id -> access token for every signed-in OAuth server (refreshed as needed).
async function oauthTokens(secrets = readSecrets()): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(state.mcpServers.filter((s) => s.oauth).map(async (s) => {
    const rec = oauthRecord(secrets, s.id);
    const token = await oauth.accessToken(s, rec, saveOauth(s.id, rec), oauthClient(s, secrets));
    if (token) out[s.id] = token;
  }));
  return out;
}

const syncMcp = async () => mcp.sync(state.mcpServers, userSecretsFrom(readSecrets()), await oauthTokens(), broadcast);

// ---------- LLM provider ----------

let claudeStatus: LoginStatus | null = null; // { loggedIn, email, plan } once checked; { checking } while checking
async function refreshClaude(): Promise<LoginStatus> {
  claudeStatus = { ...claudeStatus, checking: true };
  broadcast();
  try {
    claudeStatus = await providers.claudeStatus();
  } catch (err) {
    claudeStatus = { loggedIn: false, error: (err as Error).message };
  }
  broadcast();
  return claudeStatus;
}

// ChatGPT subscription (Codex login), used for image generation.
let chatgptStatus: LoginStatus | null = null;
let openaiModels: ModelInfo[] = []; // ChatGPT models bots can run on (value "openai:<slug>")
const codexHome = () => path.join(dataDir(), 'codex');
async function refreshChatgpt(): Promise<LoginStatus> {
  chatgptStatus = { ...chatgptStatus, checking: true };
  broadcast();
  const status: LoginStatus = await imagegen.status().catch((err: Error) => ({ loggedIn: false, error: err.message }));
  chatgptStatus = status;
  openaiModels = status.loggedIn && state.settings.chatgpt ? imagegen.models(codexHome()) : [];
  broadcast();
  return status;
}

// Model list of the active provider, refreshed when the provider changes.
let models: ModelInfo[] = [];
async function refreshModels() {
  try {
    models = await agent.fetchModels(agentEnv(readSecrets()), dataDir());
  } catch {
    models = [];
  }
  broadcast();
}

const activeProvider = (): Provider | undefined => state.settings.providers.find((p) => p.id === state.settings.provider) || state.settings.providers[0];

// Main color of a bot's AI profile icon, so its dots, name and accent match the
// character: the most common saturated-ish color that isn't the backdrop.
function imageColor(dataUrl: string): string | null {
  const img = nativeImage.createFromDataURL(dataUrl).resize({ width: 24, height: 24 });
  const px = img.toBitmap(); // BGRA
  if (!px.length) return null;
  const at = (i: number) => [px[i * 4 + 2], px[i * 4 + 1], px[i * 4]];
  const bg = at(0); // icons sit on a flat backdrop; the corner shows it
  const buckets = new Map<number, { n: number; w: number; r: number; g: number; b: number }>();
  for (let i = 0; i < px.length / 4; i++) {
    const [r, g, b] = at(i);
    if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) < 60) continue;
    const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const e = buckets.get(key) || { n: 0, w: 0, r: 0, g: 0, b: 0 };
    e.n += 1; e.w += 0.4 + sat; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const best = [...buckets.values()].sort((a, b) => b.w - a.w)[0];
  if (!best) return null;
  let rgb = [best.r, best.g, best.b].map((v) => v / best.n);
  // Keep it readable on the light sidebar: near-white goes grey.
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  if (lum > 0.78) rgb = rgb.map((v) => v * (0.62 / lum));
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
const withImageColor = <T extends Partial<Bot>>(patch: T): T => (patch.image ? { ...patch, color: imageColor(patch.image) || patch.color } : patch);

// ---------- agent turns ----------

// Look-ups for ids the renderer sends: a missing one is a stale UI, reported as an error.
const findConv = (id: string): Conv => {
  const conv = state.convs.find((c) => c.id === id);
  if (!conv) throw new Error('대화를 찾을 수 없어요');
  return conv;
};
const findBot = (id: string | undefined): Bot | undefined => state.bots.find((b) => b.id === id);
const getBot = (id: string): Bot => {
  const bot = findBot(id);
  if (!bot) throw new Error('Bot을 찾을 수 없어요');
  return bot;
};
const isBot = (b: Bot | undefined): b is Bot => Boolean(b);
function findIn<T extends { id: string }>(list: T[], id: string): T {
  const item = list.find((x) => x.id === id);
  if (!item) throw new Error('항목을 찾을 수 없어요');
  return item;
}
const findMsg = (conv: Conv, id: string): Message => findIn(conv.messages, id);
const mainWindow = (): BrowserWindow => {
  if (!win) throw new Error('창이 열려 있지 않아요');
  return win;
};
const touch = (conv: Conv) => { conv.updatedAt = Date.now(); };

// The main bot (★ in the sidebar) is the user's front desk: it knows the other
// bots and hands work to them with message_bot.
const mainBot = (): Bot | undefined => findBot(state.settings.mainBotId) || state.bots[0];

function systemPrompt(bot: Bot, conv: Conv): string {
  const timeZone = state.settings.timezone === 'auto' ? undefined : state.settings.timezone;
  const parts = [bot.systemPrompt, `현재 시각: ${new Date().toLocaleString('ko-KR', { timeZone, dateStyle: 'full', timeStyle: 'long' })}\n사용자 이름: ${state.settings.userName}`];
  if (conv.kind === 'group') {
    const others = conv.botIds.filter((id) => id !== bot.id).map((id) => findBot(id)?.name).filter(Boolean);
    parts.push(`이 대화는 그룹 채팅입니다. 당신은 ${bot.name}입니다. 함께 있는 Bot: ${others.join(', ')}. 다른 Bot의 메시지는 [이름]: 형태로 보이지만, 당신의 답에는 그런 접두사를 붙이지 마세요. 다른 Bot에게 일을 넘기거나 질문하려면 @이름으로 부르세요(부른 Bot이 이어서 답합니다). 일이 끝났거나 할 말이 없으면 아무도 부르지 말고 짧게 답하세요.`);
    const folders = conv.botIds.map(findBot).filter(isBot).filter((b) => b.id !== bot.id).map((b) => `- ${b.name}: ${workspace(b.id)}`);
    if (folders.length) parts.push(`다른 멤버의 작업 폴더(읽기 가능, 파일을 주고받을 때 경로를 알려 주세요):\n${folders.join('\n')}`);
  }
  parts.push('일을 시작하거나 새 단계로 넘어갈 때마다 mcp__characterbot__set_status로 지금 하는 일을 "학회 정보 / 검색 중"처럼 짧게 알리세요. 먼저 무엇을 할지 한두 문장으로 말한 뒤 작업하세요. 최신 정보가 필요하면 웹 검색을 쓰세요.');
  parts.push('현재 작업 폴더가 당신의 컴퓨터입니다. 만든 파일은 이 폴더에 저장하면 사용자의 라이브러리에 표시됩니다. 사용자에게 결정을 물을 때는 mcp__characterbot__ask_user를, 오래 기억할 사실은 mcp__characterbot__remember를, 반복 작업 요청은 mcp__characterbot__schedule_routine을 쓰세요. 다른 Bot에게 일을 맡기거나 물어볼 때는 mcp__characterbot__message_bot을, 사용자가 Bot이나 팀을 만들어 달라고 하면 mcp__characterbot__create_bot·create_team으로 직접 만들고(모델을 골라야 하면 list_models, 기존 Bot의 모델·지침 변경은 update_bot), 팀 전체에 일을 맡길 때는 mcp__characterbot__message_team을, 사용자가 요청하지 않은 회의 초대를 발견하면 mcp__characterbot__request_meeting_approval을 쓰세요.');
  const team = state.bots.filter((b) => b.id !== bot.id);
  if (bot.id === mainBot()?.id && team.length) {
    const role = (b: Bot) => (b.label || b.systemPrompt.split('\n')[0]).slice(0, 160);
    parts.push(`당신은 사용자의 메인 Bot입니다. 사용자가 가장 먼저 찾는 창구로서, 다른 Bot의 전문 분야에 맞는 일은 mcp__characterbot__message_bot으로 맡기고 받은 결과를 모아 정리해 보고하세요. 서로 의존하지 않는 일은 여러 Bot에게 한 번에(동시에) 맡겨도 됩니다. 간단한 일은 직접 처리하세요.\n팀 Bot:\n${team.map((b) => `- ${b.name}: ${role(b)}`).join('\n')}`);
  }
  if (state.settings.blockAccountWrites !== false) parts.push('사용자 계정과 연동된 앱(Slack, Gmail, 캘린더, Notion 등)은 읽기만 하세요. 메시지·메일 발송, 일정 생성·응답, 페이지 작성 같은 쓰기는 막혀 있으니 시도하지 말고, 보낼 내용은 채팅에 초안으로 보여주세요.');
  parts.push('답에서 다이어그램은 ```mermaid 코드 블록으로, 수식은 $...$ / $$...$$ (KaTeX)로 쓰면 채팅에 그려집니다. D3·Three.js 같은 인터랙티브 시각화는 단일 HTML 파일로 작업 폴더에 저장하면 라이브러리에서 바로 열립니다.');
  const skills = state.skills.filter((s) => bot.skillIds.includes(s.id) && !s.disabled);
  if (skills.length) parts.push(`사용 가능한 스킬 (use_skill로 전체 지침을 불러오세요):\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`);
  if (bot.memories.length) parts.push(`기억하고 있는 사실:\n${bot.memories.map((m) => `- [${m.id}] ${m.text}`).join('\n')}`);
  return parts.join('\n\n');
}

function askApproval(conv: Conv, bot: Bot, call: Call, signal: AbortSignal): Promise<{ decision: 'allow' | 'deny' | 'always'; args?: Record<string, unknown> }> {
  const request: Approval = { id: store.id('appr'), convId: conv.id, botId: bot.id, tool: call.name, args: call.args };
  runtime.pending.push(request);
  notify(bot, `승인이 필요해요: ${call.name.replace(/^mcp__(claude_ai_)?/, '').replace(/__/g, ' › ')}`);
  broadcast();
  return new Promise((resolve) => {
    const done: ApprovalDone = (decision, args) => {
      approvals.delete(request.id);
      runtime.pending = runtime.pending.filter((p) => p.id !== request.id);
      broadcast();
      resolve({ decision, args });
    };
    approvals.set(request.id, done);
    signal.addEventListener('abort', () => done('deny'), { once: true });
  });
}

function createRoutine(conv: Conv, bot: Bot, args: ScheduleInput & { prompt: string }): Routine {
  if (state.routines.filter((r) => r.enabled).length >= routines.MAX_ENABLED) throw new Error(`활성 루틴은 최대 ${routines.MAX_ENABLED}개입니다`);
  const routine: Routine = {
    id: store.id('rtn'), convId: conv.id, botId: bot.id, prompt: args.prompt,
    schedule: routines.validateSchedule(args), enabled: true, createdAt: Date.now(), lastRun: 0, failures: 0,
  };
  state.routines.push(routine);
  syncTriggers(); // webhook server / watcher up before the bot hands out the address
  return routine;
}

function agentEnv(secrets: SecretStore): NodeJS.ProcessEnv {
  const provider = activeProvider();
  // User secrets stay out: they only reach MCP configs through ${NAME} placeholders.
  return providers.env(process.env, provider, providerKey(secrets, provider?.id), Object.keys(userSecretsFrom(secrets)));
}

// Records one finished tool call: transcript entry content, cards and audit row.
function finishTool(conv: Conv, bot: Bot, toolMsg: Message, output: string, isError: boolean, initiator: Initiator, secretValues: string[]): void {
  const name = toolMsg.name || '';
  const args = (toolMsg.args || {}) as Record<string, string>;
  toolMsg.content = gateway.maskSecrets(output, secretValues);
  if (isError && toolMsg.effect !== 'deny' && !toolMsg.content.startsWith('Error:')) toolMsg.content = `Error: ${toolMsg.content}`;
  const short = name.replace(/^mcp__characterbot__/, '');
  if (!isError && short === 'ask_user') toolMsg.card = { type: 'question', question: args.question, options: (toolMsg.args?.options as string[]) || [] };
  if (!isError && short === 'request_meeting_approval') toolMsg.card = { ...args, type: 'meeting', title: args.title };
  if (!isError && short === 'propose_skill') toolMsg.card = { type: 'skill', name: args.name, description: args.description, body: args.body };
  state.audit.push({
    id: store.id('aud'), ts: Date.now(), botId: bot.id, convId: conv.id, tool: name, initiator,
    args: JSON.parse(gateway.maskSecrets(JSON.stringify(toolMsg.args), secretValues)),
    effect: toolMsg.effect || 'allow', outcome: toolMsg.effect === 'deny' ? 'refused' : isError ? 'error' : 'ok',
    output: toolMsg.content.slice(0, 4000),
  });
  if (state.audit.length > 1000) state.audit.splice(0, state.audit.length - 1000);
}

// Auto-review: explicit "always allow" rules, then the user's natural-language
// rules (judged by a small model), then per-tool defaults. Off = allow all.
const judgeCache = new Map<string, number[]>();
async function review(call: Call, secrets: SecretStore): Promise<{ effect: Effect; reason?: string; rule?: Rule | null }> {
  const s = state.settings;
  // Hard stop: never write to apps linked to the user's real accounts (no rule,
  // draft or meeting card can lift it; only the setting can).
  const remote = state.mcpServers.filter((sv) => sv.url).map((sv) => mcp.slug(sv.name));
  // Bash follows 설정 › 컴퓨터 › 이 컴퓨터에서 실행.
  if (s.blockAccountWrites !== false && gateway.accountWrite(call.name, remote)) {
    return { effect: 'deny', reason: '사용자 계정과 연동된 앱(Slack, Gmail, 캘린더 등)에 쓰는 작업은 막혀 있습니다. 보내려던 내용은 채팅에 초안으로 보여주세요.' };
  }
  if (!s.autoReview) return { effect: 'allow' };
  const base = gateway.decide(call, state.rules, { Bash: s.computerAccess });
  if (base.rule || call.name.startsWith('mcp__characterbot__') || !s.reviewRules.length) return base;
  const key = JSON.stringify([s.reviewRules, call.name, call.args]);
  try {
    if (!judgeCache.has(key)) judgeCache.set(key, await agent.judgeRules({ rules: s.reviewRules, call, env: agentEnv(secrets) }));
  } catch {
    return gateway.finalize('ask', null, call); // a failed review never widens access
  }
  const effect = gateway.combine((judgeCache.get(key) || []).map((i) => s.reviewRules[i].effect));
  return effect ? gateway.finalize(effect, null, call) : base;
}

const promptOpts = () => ({ bots: state.bots, userName: state.settings.userName, skills: state.skills });

// A new session gets the whole chat. Past COMPACT_CHARS, everything but the
// recent tail goes in as a summary (cached on the conversation, extended as it grows).
const COMPACT_CHARS = 40_000;
const KEEP_RECENT = 20; // messages replayed verbatim
async function replayPrompt(conv: Conv, bot: Bot, signal: AbortSignal): Promise<Prompt> {
  const full = pendingPrompt(conv, bot.id, promptOpts(), 0);
  const cut = conv.messages.length - KEEP_RECENT;
  if (full.text.length <= COMPACT_CHARS || cut <= 0) return full;
  if (!conv.summary || conv.messages.length - conv.summary.upto > 2 * KEEP_RECENT) {
    const from = conv.summary?.upto || 0;
    const older = pendingPrompt({ kind: 'group', messages: conv.messages.slice(from, cut) }, null, promptOpts()).text;
    try {
      conv.summary = { upto: cut, text: await agent.summarize({ previous: conv.summary?.text, text: older.slice(-200_000), env: agentEnv(readSecrets()) }), ts: Date.now() };
    } catch {
      if (signal.aborted || !conv.summary) return full; // no summary: fall back to the full replay
    }
  }
  const summary = conv.summary;
  if (!summary) return full;
  const recent = pendingPrompt(conv, bot.id, promptOpts(), summary.upto);
  return { text: `(앞선 대화 요약)\n${summary.text}\n\n(최근 대화)\n${recent.text}`, images: recent.images };
}

// One bot answers through the Claude Agent SDK. Returns false on error.
// tag: fields stamped on every message of this turn ({ threadOf } or { viaBotId }).
async function botTurn(conv: Conv, bot: Bot, initiator: Initiator, signal: AbortSignal, tag: Tag = {}): Promise<boolean> {
  conv.sessions ||= {};
  const session = conv.sessions[bot.id] || { id: null, cursor: 0 };
  // ChatGPT models run on Codex; switching engines starts a new session that
  // gets the whole chat so far.
  const model = bot.model || state.settings.model;
  const engine: 'codex' | 'claude' = model.startsWith('openai:') ? 'codex' : 'claude';
  if ((session.engine || 'claude') !== engine) Object.assign(session, { id: null, cursor: 0, engine });
  const pending = session.id
    ? pendingPrompt(conv, bot.id, promptOpts(), session.cursor)
    : await replayPrompt(conv, bot, signal);
  const { images } = pending;
  // "@Notion" in the chat points the bot at that app, even one it isn't set up with.
  const tagged = state.mcpServers.filter((sv) => sv.enabled && pending.text.toLowerCase().includes(`@${sv.name.toLowerCase()}`));
  const others = state.bots.filter((b) => b.id !== bot.id).map((b) => b.name);
  const threadNote = tag.threadOf ? `\n\n(스레드 대화입니다${conv.kind === 'dm' && conv.botIds[0] !== bot.id ? ` — ${findBot(conv.botIds[0])?.name}와(과) 사용자의 대화에 초대받았습니다` : ''}. 다른 Bot의 의견이나 도움이 필요하면 답에서 @이름으로 부르세요. 부른 Bot이 이 스레드에서 이어서 답합니다. 부를 수 있는 Bot: ${others.join(', ')}. 할 말이 끝났으면 아무도 부르지 마세요.)` : '';
  const quiet = initiator === 'routine' ? `\n\n(정기 점검입니다. 사용자에게 먼저 알릴 만한 새 소식이나 할 일이 없으면 다른 말 없이 정확히 ${QUIET} 이라고만 답하세요. 있으면 바로 본론부터 알려 주세요.)` : '';
  const text = (tagged.length ? `${pending.text}\n\n(사용자가 ${tagged.map((sv) => `@${sv.name}`).join(', ')} 앱을 지목했어요. 이 앱의 도구(${tagged.map((sv) => `mcp__${mcp.slug(sv.name)}__*`).join(', ')})를 사용하세요.)` : pending.text) + threadNote + quiet;
  const serverIds = [...new Set([...bot.serverIds, ...tagged.map((sv) => sv.id)])];
  const ws = workspace(bot.id);
  const secrets = readSecrets();
  const secretValues = Object.values(userSecretsFrom(secrets));
  const toolMsgs = new Map<string, Message>(); // tool_use_id -> transcript entry
  const decisions = new Map<string, Effect>(); // tool_use_id -> effect
  const sent = new Map<string, Record<string, unknown>>(); // tool_use_id -> args of an approved draft
  let current: Message | null = null;
  let failure: string | null = null;

  const toolCtx: ToolCtx = {
    bot, state,
    messageBot: (name, message) => messageBot(bot, name, message, initiator, conv),
    createRoutine: (args) => createRoutine(conv, bot, args),
    webhookUrl: triggers.webhookUrl,
    cancelRoutine: (id) => { const r = state.routines.find((x) => x.id === id && x.convId === conv.id); if (r) r.enabled = false; },
    models: () => [...models, ...openaiModels],
    createBot: (args) => {
      const made = createBotFor(args);
      greet(bot, made);
      return made;
    },
    updateBot: (args) => updateBotFor(args),
    createTeam: (name, names) => {
      if (state.convs.some((c) => c.kind === 'group' && c.name === name.trim())) throw new Error(`"${name}" 팀이 이미 있어요`);
      const members = [bot, ...botsNamed(names)].filter((b, i, all) => all.indexOf(b) === i);
      const team = findConv(actions.createGroup(name.trim(), members.map((b) => b.id)));
      broadcast();
      return `"${team.name}" 팀을 만들었어요. 팀원: ${members.map((b) => b.name).join(', ')}`;
    },
    addToTeam: (name, names) => {
      const team = teamNamed(name);
      for (const b of botsNamed(names)) if (!team.botIds.includes(b.id)) team.botIds.push(b.id);
      broadcast();
      return `"${team.name}" 팀원: ${team.botIds.map((id) => findBot(id)?.name).filter(Boolean).join(', ')}`;
    },
    messageTeam: (name, message, mention) => messageTeam(bot, teamNamed(name), message, mention || [], initiator, conv),
    setStatus: (subject, verb) => {
      const a = runtime.active[conv.id];
      if (a?.botId === bot.id) { a.status = { subject: subject.slice(0, 40), verb: verb.slice(0, 20) }; broadcast(); }
    },
  };

  const setPhase = (phase: ActiveRun['phase']) => { if (runtime.active[conv.id]?.botId === bot.id) runtime.active[conv.id].phase = phase; };

  const newAssistant = (): Message => {
    const msg: Message = { id: store.id('msg'), role: 'assistant', botId: bot.id, content: '', toolCalls: [], ts: Date.now(), ...tag };
    current = msg;
    conv.messages.push(msg);
    broadcast();
    return msg;
  };

  // External-app writes come to the user as an editable draft (unless this bot's
  // drafts are off); what the user sends is what the tool gets.
  const gate = async (call: Call & { id: string }): Promise<GateResult> => {
    const decision = await review({ ...call, botId: bot.id, initiator }, secrets);
    let effect = decision.effect;
    let updatedInput: Record<string, unknown> | undefined;
    const external = call.name.startsWith('mcp__') && !call.name.startsWith('mcp__characterbot__');
    const granted = grants.get(bot.id) || 0;
    if (effect === 'ask' && external && /calendar|event/i.test(call.name) && granted) {
      grants.set(bot.id, granted - 1);
      effect = 'allow';
    }
    if (effect === 'ask' && external && bot.drafts === false) effect = 'allow';
    if (effect === 'ask') {
      const answer = await askApproval(conv, bot, call, signal);
      if (answer.decision === 'always') state.rules.push({ id: store.id('rule'), effect: 'allow', tool: call.name, botId: bot.id });
      effect = answer.decision === 'deny' ? 'deny' : 'allow';
      if (effect === 'allow' && external) {
        updatedInput = answer.args || call.args;
        sent.set(call.id, updatedInput);
      }
    }
    decisions.set(call.id, effect);
    const msg = toolMsgs.get(call.id);
    if (msg) Object.assign(msg, { effect }, sent.has(call.id) ? { args: sent.get(call.id), sent: true } : {});
    const edited = updatedInput && JSON.stringify(updatedInput) !== JSON.stringify(call.args);
    const note = edited ? `사용자가 초안을 고쳐서 보냈습니다. 실제로 보낸 내용: ${JSON.stringify(updatedInput)}` : undefined;
    return { effect, updatedInput, note, reason: effect === 'deny' ? decision.reason || '사용자 또는 자동 검토 규칙이 거부했습니다' : undefined };
  };

  // The SDK streams deltas, then sends one snapshot per content block; both are
  // keyed by the API message id so they land in the same transcript entry.
  const byApiId = new Map<string, Message>();
  const entryFor = (apiId: string): Message => {
    let msg = byApiId.get(apiId);
    if (!msg) byApiId.set(apiId, (msg = newAssistant()));
    return msg;
  };
  const onMessage = (m: SDKMessage) => {
    if ('parent_tool_use_id' in m && m.parent_tool_use_id) return; // subagent traffic stays inside its Task call
    if (m.type === 'system' && m.subtype === 'init') session.id = m.session_id;
    if (m.type === 'stream_event') {
      const ev = m.event;
      if (ev.type === 'message_start') { current = entryFor(ev.message.id); setPhase('thinking'); }
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && current) {
        current.content += ev.delta.text;
        win?.webContents.send('stream', { convId: conv.id, msgId: current.id, text: ev.delta.text });
      }
    }
    if (m.type === 'assistant') {
      const msg = entryFor(m.message.id);
      const blocks = m.message.content;
      const text = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n');
      if (text && !msg.content.includes(text)) msg.content += (msg.content ? '\n\n' : '') + text;
      const uses = blocks.flatMap((b) => (b.type === 'tool_use' ? [b] : []));
      if (uses.length) setPhase('working');
      for (const b of uses) {
        const input = (b.input || {}) as Record<string, unknown>;
        (msg.toolCalls ||= []).push({ id: b.id, name: b.name, args: input });
        const toolMsg: Message = { id: store.id('msg'), role: 'tool', botId: bot.id, toolCallId: b.id, name: b.name, args: sent.get(b.id) || input, content: '', ts: Date.now(), effect: decisions.get(b.id), ...(sent.has(b.id) ? { sent: true } : {}), ...tag };
        toolMsgs.set(b.id, toolMsg);
        conv.messages.push(toolMsg);
      }
      touch(conv);
      broadcast();
    }
    if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const b of m.message.content) {
        if (typeof b === 'string' || b.type !== 'tool_result') continue;
        const toolMsg = toolMsgs.get(b.tool_use_id);
        if (toolMsg) finishTool(conv, bot, toolMsg, agent.resultText(b.content), Boolean(b.is_error), initiator, secretValues);
      }
      broadcast();
    }
    if (m.type === 'result') {
      session.id = m.session_id;
      const u = m.usage;
      state.usage.turns += 1;
      state.usage.costUsd += m.total_cost_usd || 0;
      state.usage.inputTokens += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      state.usage.outputTokens += u.output_tokens || 0;
      if (m.subtype !== 'success') failure = m.errors.join('\n') || m.subtype;
      else if (m.is_error) failure = m.result || m.subtype;
    }
  };

  try {
    if (engine === 'codex') await codexTurn();
    else await agent.runTurn({
      prompt: text,
      images,
      sessionId: session.id,
      cwd: ws,
      additionalDirectories: conv.kind === 'group' ? conv.botIds.filter((id) => id !== bot.id && findBot(id)).map((id) => workspace(id)) : [],
      model,
      systemPrompt: systemPrompt(bot, conv),
      env: agentEnv(secrets),
      mcpServers: mcp.toSdkConfig(state.mcpServers, serverIds, userSecretsFrom(secrets), await oauthTokens(secrets)),
      signal,
      gate,
      appServer: (agentSdk) => tools.buildServer(agentSdk, toolCtx),
      onMessage,
    });
  } catch (err) {
    failure = signal.aborted ? '중지됨' : (err as Error).message;
  }

  // ChatGPT turn: Codex runs its own shell, file and web tools inside the
  // sandbox chosen by 컴퓨터 access; it has no MCP apps, so it can't write to
  // the user's accounts. Its tool items become hidden tool entries (컴퓨터 tab).
  async function codexTurn() {
    if (!state.settings.chatgpt || !chatgptStatus?.loggedIn) throw new Error('설정 › 모델에서 ChatGPT를 연결하세요');
    const inbox = path.join(dataDir(), 'codex-inbox');
    fs.mkdirSync(inbox, { recursive: true });
    const files = images.map((img, i) => {
      const file = path.join(inbox, `${Date.now()}-${i}.${img.mediaType.split('/')[1]}`);
      fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
      return file;
    });
    const items = new Map<string, Message>(); // Codex item id -> transcript entry
    const asTool = (it: ThreadItem): { name: string; args: Record<string, unknown>; out: string; failed: boolean } | null => {
      switch (it.type) {
        case 'command_execution': return { name: 'Bash', args: { command: it.command }, out: it.aggregated_output, failed: it.status === 'failed' || (it.exit_code ?? 0) !== 0 };
        case 'file_change': return { name: 'Edit', args: { file_path: it.changes.map((c) => `${c.kind} ${path.relative(ws, c.path)}`).join(', ') }, out: it.status, failed: it.status === 'failed' };
        case 'mcp_tool_call': return { name: `mcp__${it.server}__${it.tool}`, args: (it.arguments || {}) as Record<string, unknown>, out: it.error?.message || agent.resultText(it.result?.content), failed: Boolean(it.error) };
        case 'web_search': return { name: 'WebSearch', args: { query: it.query }, out: '', failed: false };
        default: return null;
      }
    };
    const on = (ev: ThreadEvent) => {
      if (ev.type === 'turn.started') setPhase('thinking');
      if (ev.type === 'turn.failed') failure = ev.error.message;
      if (ev.type === 'error') failure = ev.message;
      if (ev.type === 'turn.completed') {
        state.usage.turns += 1;
        state.usage.inputTokens += ev.usage.input_tokens + ev.usage.cached_input_tokens;
        state.usage.outputTokens += ev.usage.output_tokens;
      }
      if (!('item' in ev)) return;
      const it = ev.item;
      if (it.type === 'agent_message') {
        let msg = items.get(it.id);
        if (!msg) items.set(it.id, (msg = newAssistant()));
        if (it.text.startsWith(msg.content) && it.text.length > msg.content.length) {
          const delta = it.text.slice(msg.content.length);
          msg.content = it.text;
          win?.webContents.send('stream', { convId: conv.id, msgId: msg.id, text: delta });
        } else msg.content = it.text;
        if (ev.type === 'item.completed') { touch(conv); broadcast(); }
        return;
      }
      const t = asTool(it);
      if (!t) return;
      setPhase('working');
      let toolMsg = items.get(it.id);
      if (!toolMsg) {
        toolMsg = { id: store.id('msg'), role: 'tool', botId: bot.id, toolCallId: it.id, name: t.name, args: t.args, content: '', ts: Date.now(), effect: 'allow', ...tag } as Message;
        items.set(it.id, toolMsg);
        conv.messages.push(toolMsg);
      }
      if (ev.type === 'item.completed') finishTool(conv, bot, toolMsg, t.out || '', t.failed, initiator, secretValues);
      broadcast();
    };
    const sandbox = ({ allow: 'danger-full-access', ask: 'workspace-write', deny: 'read-only' } as const satisfies Record<Effect, SandboxMode>)[state.settings.computerAccess] || 'workspace-write';
    // Only the app tools (mcp__characterbot__*) come along; no account-linked apps.
    const appTools = await tools.openHttpTurn(toolCtx);
    try {
      session.id = await imagegen.runTurn({
        home: codexHome(), threadId: session.id, prompt: text, images: files, cwd: ws, model: model.slice('openai:'.length),
        instructions: `${systemPrompt(bot, conv)}\n\n(이 실행 환경에서는 characterbot MCP 서버의 도구(ask_user, remember, message_bot 등)만 쓸 수 있고, 사용자 계정과 연동된 앱은 없습니다.)`,
        sandbox, additionalDirectories: conv.kind === 'group' ? conv.botIds.filter((id) => id !== bot.id && findBot(id)).map((id) => workspace(id)) : [],
        appTools, signal, on,
      });
    } finally {
      appTools.close();
      for (const f of files) fs.rmSync(f, { force: true });
    }
  }
  // Models sometimes echo the "[Name]:" prefix they see on group messages.
  const echoed = `[${bot.name}]:`;
  for (const m of conv.messages) if (m.botId === bot.id && m.role === 'assistant' && m.content?.startsWith(echoed)) m.content = m.content.slice(echoed.length).trimStart();
  // Drop entries that only carried thinking.
  conv.messages = conv.messages.filter((m) => !(m.role === 'assistant' && m.botId === bot.id && !m.content && !m.toolCalls?.length && !m.error));
  // The SDK also sends an error as an assistant message; keep only the error entry below.
  const failed = failure as string | null; // assigned inside callbacks
  if (failed) conv.messages = conv.messages.filter((m) => !(m.role === 'assistant' && m.botId === bot.id && m.content && failed.includes(m.content.trim())));
  session.cursor = conv.messages.length;
  conv.sessions[bot.id] = session;
  if (failed) {
    conv.messages.push({ id: store.id('msg'), role: 'assistant', botId: bot.id, content: '', error: failed.replace(/^Claude Code returned an error result: /, ''), ts: Date.now(), ...tag });
  } else {
    const last = [...conv.messages].reverse().find((m) => m.botId === bot.id && (m.content || m.card));
    const card = last?.card;
    if (last && !last.content?.includes(QUIET)) Object.assign(conv, { unread: true, hidden: false }); // the open chat clears it
    if (!last?.content?.includes(QUIET)) notify(bot, card?.type === 'meeting' ? `회의 초대: ${card.title} · ${card.start}` : card?.type === 'question' ? card.question : last?.content);
  }
  touch(conv);
  broadcast();
  return !failed;
}

function notify(bot: Bot, body: string | undefined): void {
  if (!state.settings.notifications || !body || win?.isFocused() || !Notification.isSupported()) return;
  new Notification({ title: bot.name, body: body.slice(0, 200) }).show();
}

// Runs the responders in order; in a group, a reply that @mentions another
// member hands the conversation to it (bounded so bots can't loop forever).
async function respond(conv: Conv, botIds: string[], initiator: Initiator, tag: Tag = {}): Promise<boolean> {
  if (runtime.running.has(conv.id)) return false;
  const controller = new AbortController();
  runtime.running.set(conv.id, controller);
  runtime.started[conv.id] = Date.now();
  const ran = new Set<string>();
  broadcast();
  let ok = true;
  try {
    const queue = [...botIds];
    for (let turns = 0; queue.length && turns < 16 && !controller.signal.aborted; turns++) {
      const bot = findBot(queue.shift());
      if (!bot) continue;
      const before = conv.messages.length;
      runtime.active[conv.id] = { botId: bot.id, phase: 'thinking', queue, ...tag }; // queue: bots still to answer
      ran.add(bot.id);
      ok = (await botTurn(conv, bot, initiator, controller.signal, tag)) && ok;
      if (conv.kind !== 'group' && !tag.threadOf) continue;
      const reply = conv.messages.slice(before).filter((m) => m.role === 'assistant').map((m) => m.content).join('\n');
      const members = (tag.threadOf ? state.bots : conv.botIds.map(findBot).filter(isBot)).filter((b) => b.id !== bot.id);
      for (const id of mentionedBots(reply, members)) if (!queue.includes(id)) queue.push(id);
    }
  } finally {
    runtime.history = [{ convId: conv.id, botIds: [...ran], initiator, start: runtime.started[conv.id], end: Date.now(), ok: ok && !controller.signal.aborted, stopped: controller.signal.aborted }, ...runtime.history].slice(0, 30);
    delete runtime.started[conv.id];
    runtime.running.delete(conv.id);
    delete runtime.active[conv.id];
    touch(conv);
    broadcast();
  }
  return ok;
}

function postUserMessage(conv: Conv, fields: Partial<Message>, initiator: Initiator = 'user'): Promise<boolean> {
  conv.messages.push({ content: '', ...fields, id: store.id('msg'), role: 'user', ts: Date.now() });
  touch(conv);
  if (fields.threadOf) {
    // Threads are where bots talk to each other: any bot can be @named into one;
    // otherwise the bots already in the thread answer.
    const named = mentionedBots(fields.content || '', state.bots);
    return respond(conv, named.length ? named : threadBots(conv, fields.threadOf), initiator, { threadOf: fields.threadOf });
  }
  const members = conv.botIds.map(findBot).filter(isBot);
  const everyone = /@(모든 사람|everyone)/i.test(fields.content || '');
  const mentioned = conv.kind === 'group' && !everyone ? mentionedBots(fields.content || '', members) : [];
  return respond(conv, mentioned.length ? mentioned : conv.botIds, initiator);
}

// Bots taking part in a thread: the root's author and everyone who replied.
function threadBots(conv: Conv, rootId: string): string[] {
  const ids = conv.messages.filter((m) => (m.id === rootId || m.threadOf === rootId) && m.role === 'assistant' && findBot(m.botId)).map((m) => m.botId as string);
  return ids.length ? [...new Set(ids)] : conv.botIds;
}

// A bot DMs another bot (mcp__characterbot__message_bot): the message lands in the
// target's chat, the target answers there, and the answer goes back as the tool
// result. One hop only, so two bots can't keep each other busy.
async function messageBot(from: Bot, name: string, text: string, initiator: Initiator, fromConv: Conv): Promise<string> {
  if (initiator === 'bot') throw new Error('다른 Bot이 맡긴 일을 하는 중에는 또 다른 Bot에게 보낼 수 없어요');
  const others = state.bots.filter((b) => b.id !== from.id);
  const target = others.find((b) => b.name.toLowerCase() === name.trim().replace(/^@/, '').toLowerCase());
  if (!target) throw new Error(`"${name}" Bot이 없어요. 보낼 수 있는 Bot: ${others.map((b) => b.name).join(', ')}`);
  const dm = state.convs.find((c) => c.kind === 'dm' && c.botIds[0] === target.id);
  if (!dm) throw new Error(`${target.name}과(와)의 대화가 없어요`);
  // Busy target: wait in line (up to 10 minutes) instead of failing.
  for (const until = Date.now() + 600_000; runtime.running.has(dm.id);) {
    if (Date.now() > until) throw new Error(`${target.name}이(가) 계속 다른 일을 하고 있어요. 나중에 다시 보내세요`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const start = dm.messages.length;
  // Shown as "A, B 및 C 작업 중…" in the conversation that handed the work out.
  const active = runtime.active[fromConv.id];
  if (active) active.delegates = [...(active.delegates || []), target.id];
  dm.messages.push({ id: store.id('msg'), role: 'user', ts: Date.now(), content: text, fromBotId: from.id, viaBotId: from.id });
  touch(dm);
  try {
    await respond(dm, [target.id], 'bot', { viaBotId: from.id });
  } finally {
    if (active) active.delegates = (active.delegates || []).filter((id) => id !== target.id);
    broadcast();
  }
  const reply = dm.messages.slice(start).filter((m) => m.role === 'assistant' && (m.content || m.error)).map((m) => m.content || `오류: ${m.error}`).join('\n\n');
  return reply || `${target.name}이(가) 답하지 않았어요`;
}

// Bots and teams made by a bot (create_bot / create_team), like Grok Bot's
// "make me a reviewer team". Names are matched case-insensitively.
const byName = (name: string) => (b: Bot) => b.name.toLowerCase() === name.trim().replace(/^@/, '').toLowerCase();
function botsNamed(names: string[]): Bot[] {
  return names.map((n) => {
    const b = state.bots.find(byName(n));
    if (!b) throw new Error(`"${n}" Bot이 없어요. 먼저 create_bot으로 만드세요. 있는 Bot: ${state.bots.map((x) => x.name).join(', ')}`);
    return b;
  });
}
function teamNamed(name: string): Conv {
  const teams = state.convs.filter((c) => c.kind === 'group');
  const team = teams.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (!team) throw new Error(`"${name}" 팀이 없어요. 있는 팀: ${teams.map((c) => c.name).join(', ') || '없음'}`);
  return team;
}
function createBotFor({ name, role, instructions, model }: { name: string; role: string; instructions?: string; model?: string }): Bot {
  if (!name.trim()) throw new Error('이름이 필요해요');
  if (state.bots.some(byName(name))) throw new Error(`"${name}" Bot이 이미 있어요`);
  const known = [...models, ...openaiModels];
  if (model && !known.some((m) => m.value === model)) throw new Error(`모르는 모델이에요. list_models의 value 중에서 고르세요`);
  const bot = getBot(findConv(actions.createBot(name.trim())).botIds[0]);
  Object.assign(bot, {
    label: role.trim().slice(0, 80),
    model: model || '',
    systemPrompt: `${instructions?.trim() || `당신은 ${name}입니다. 역할: ${role}`}\n\n사용자의 언어로 답하세요.`,
  });
  broadcast();
  return bot;
}

function updateBotFor({ name, role, instructions, model }: { name: string; role?: string; instructions?: string; model?: string }): Bot {
  const [bot] = botsNamed([name]);
  if (model !== undefined && model && ![...models, ...openaiModels].some((m) => m.value === model)) throw new Error(`모르는 모델이에요. list_models의 value 중에서 고르세요`);
  if (role?.trim()) bot.label = role.trim().slice(0, 80);
  if (instructions?.trim()) bot.systemPrompt = `${instructions.trim()}\n\n사용자의 언어로 답하세요.`;
  if (model !== undefined) bot.model = model;
  broadcast();
  return bot;
}

// Like Grok Bot, a Bot made by another Bot says hello first. The maker's note
// stays folded under the greeting as "보낸 사람 [maker]".
function greet(from: Bot, bot: Bot): void {
  const dm = state.convs.find((c) => c.kind === 'dm' && c.botIds[0] === bot.id);
  if (!dm) return;
  dm.messages.push({
    id: store.id('msg'), role: 'user', ts: Date.now(), fromBotId: from.id, brief: true,
    content: `${from.name}이(가) 당신을 만들었어요. ${state.settings.userName}님에게 먼저 인사하고, 맡은 역할로 무엇을 해 줄 수 있는지와 시작하려면 무엇이 필요한지 2~4문장으로 말하세요. 도구는 쓰지 마세요.`,
  });
  touch(dm);
  void respond(dm, [bot.id], 'bot');
}

// A bot posts to a team chat (message_team); the mentioned members, or all of
// them, answer there and their replies come back as the tool result.
async function messageTeam(from: Bot, team: Conv, text: string, mention: string[], initiator: Initiator, fromConv: Conv): Promise<string> {
  if (initiator === 'bot') throw new Error('다른 Bot이 맡긴 일을 하는 중에는 팀에 보낼 수 없어요');
  const members = team.botIds.filter((id) => id !== from.id);
  const targets = mention.length ? botsNamed(mention).map((b) => b.id).filter((id) => members.includes(id)) : members;
  if (!targets.length) throw new Error(`"${team.name}" 팀에 답할 Bot이 없어요`);
  for (const until = Date.now() + 600_000; runtime.running.has(team.id);) {
    if (Date.now() > until) throw new Error(`"${team.name}" 팀이 계속 다른 일을 하고 있어요`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const start = team.messages.length;
  const active = runtime.active[fromConv.id];
  if (active) active.delegates = [...(active.delegates || []), ...targets];
  team.messages.push({ id: store.id('msg'), role: 'user', ts: Date.now(), content: text, fromBotId: from.id });
  touch(team);
  try {
    await respond(team, targets, 'bot');
  } finally {
    if (active) active.delegates = (active.delegates || []).filter((id) => !targets.includes(id));
    broadcast();
  }
  const replies = team.messages.slice(start).filter((m) => m.role === 'assistant' && (m.content || m.error));
  return replies.map((m) => `[${findBot(m.botId)?.name}] ${m.content || `오류: ${m.error}`}`).join('\n\n') || '팀에서 아무도 답하지 않았어요';
}

// ---------- routines ----------

function tickRoutines() {
  const now = Date.now();
  for (const routine of state.routines) {
    const conv = state.convs.find((c) => c.id === routine.convId);
    if (!conv || !routines.isDue(routine, now) || runtime.running.has(conv.id)) continue;
    routine.lastRun = now;
    runRoutine(routine, conv);
  }
  // Events that arrived while the chat was busy, merged into one run.
  for (const routine of state.routines.filter((r) => r.pending?.length)) {
    const events = routine.pending || [];
    routine.pending = [];
    fireEvent(routine, events.join('\n\n---\n\n'));
  }
  syncTriggers();
}

// A routine is a proactive check: when the bot has nothing worth telling, it
// answers QUIET and the whole run is dropped from the chat (no ping, no clutter).
const QUIET = '[조용히]';
// An event trigger fired: run now, or hold the event until the chat is free
// (and at most once a minute per routine).
function fireEvent(routine: Routine, event: string): void {
  const conv = state.convs.find((c) => c.id === routine.convId);
  if (!conv || !routine.enabled) return;
  if (runtime.running.has(conv.id) || Date.now() - routine.lastRun < 60_000) {
    routine.pending = [...(routine.pending || []), event].slice(-5);
    return;
  }
  routine.lastRun = Date.now();
  runRoutine(routine, conv, event);
}

function syncTriggers() {
  triggers.sync(state.routines, fireEvent);
}

async function runRoutine(routine: Routine, conv: Conv, event: string | null = null): Promise<void> {
  const start = conv.messages.length;
  const updatedAt = conv.updatedAt;
  conv.messages.push({ id: store.id('msg'), role: 'user', ts: Date.now(), content: `⏰ 루틴: ${routine.prompt}`, routineId: routine.id, ...(event ? { event } : {}) });
  touch(conv);
  const ok = await respond(conv, [routine.botId], 'routine');
  const run = conv.messages.slice(start);
  const said = run.filter((m) => m.role === 'assistant' && (m.content || m.error));
  if (ok && said.length && said.every((m) => m.content.trim() === QUIET) && !run.some((m) => m.card)) {
    conv.messages.splice(start);
    if (conv.sessions?.[routine.botId]) conv.sessions[routine.botId].cursor = start;
    conv.updatedAt = updatedAt;
  }
  routine.failures = ok ? 0 : routine.failures + 1;
  if (routine.failures >= routines.MAX_FAILURES) routine.enabled = false;
  broadcast();
}

// ---------- plugins ----------

function installPlugin(dir: string): void {
  const plugin = plugins.readPlugin(dir);
  if (state.plugins.some((p) => p.name === plugin.name)) throw new Error(`"${plugin.name}" 플러그인이 이미 설치되어 있습니다`);
  const pluginId = store.id('plg');
  state.plugins.push({ id: pluginId, name: plugin.name, description: plugin.description, version: plugin.version, path: dir, enabled: true });
  for (const [name, cfg] of Object.entries(plugin.mcpServers)) addServer({ name, ...cfg }, pluginId);
  for (const skill of plugin.skills) addSkill(skill, pluginId);
  syncMcp();
}

function setPluginEnabled(pluginId: string, enabled: boolean): void {
  const plugin = state.plugins.find((p) => p.id === pluginId);
  if (plugin) plugin.enabled = enabled;
  for (const s of state.mcpServers) if (s.source === pluginId) s.enabled = enabled;
  for (const s of state.skills) if (s.source === pluginId) s.disabled = !enabled;
  syncMcp();
}

function removePlugin(pluginId: string): void {
  state.plugins = state.plugins.filter((p) => p.id !== pluginId);
  state.mcpServers = state.mcpServers.filter((s) => s.source !== pluginId);
  state.skills = state.skills.filter((s) => s.source !== pluginId);
  syncMcp();
}

// New servers and skills are granted to every bot; each bot can turn them off.
type ServerInput = Partial<Omit<McpServer, 'id' | 'enabled' | 'source'>> & { serverUrl?: string };
function addServer(cfg: ServerInput, source = 'user'): McpServer {
  const { name, command, args, env, headers, oauth: auth } = cfg;
  const url = cfg.url || cfg.serverUrl;
  if (!name || (!command && !url)) throw new Error('MCP 서버에는 name과 command 또는 url이 필요합니다');
  const server: McpServer = { id: store.id('mcp'), name, command, args, env, url, headers, oauth: url && auth ? auth : undefined, enabled: true, source };
  state.mcpServers.push(server);
  for (const bot of state.bots) bot.serverIds.push(server.id);
  return server;
}

function addSkill({ name, description = '', body = '' }: { name?: string; description?: string; body?: string }, source = 'user'): Skill {
  if (!name?.trim()) throw new Error('스킬 이름이 필요합니다');
  const skill: Skill = { id: store.id('skl'), name: name.trim(), description, body, source };
  state.skills.push(skill);
  for (const bot of state.bots) bot.skillIds.push(skill.id);
  return skill;
}

// ---------- voice memos ----------

// Compiles stt.swift once (needs the Xcode command line tools), then runs it.
let sttBin: Promise<string> | null = null;
function runStt(file: string): Promise<string> {
  const exec = (cmd: string, args: string[], timeout: number) => new Promise<string>((resolve, reject) => execFile(cmd, args, { timeout }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim().split('\n').pop())) : resolve(out.trim()))));
  sttBin ||= (async () => {
    const bin = path.join(dataDir(), 'bin', 'stt');
    const src = path.join(__dirname, 'stt.swift');
    if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      await exec('swiftc', ['-O', src, '-o', bin], 300_000);
    }
    return bin;
  })().catch((err) => { sttBin = null; throw err; });
  return sttBin.then((bin) => exec(bin, [file, 'ko-KR'], 120_000));
}

// ---------- attachments ----------

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function readAttachment(file: string): Attachment {
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);
  const name = path.basename(file);
  if (IMAGE_TYPES[ext]) {
    if (buf.length > 4 * 1024 * 1024) throw new Error(`${name}: 이미지는 4MB까지 첨부할 수 있습니다`);
    return { name, dataUrl: `data:${IMAGE_TYPES[ext]};base64,${buf.toString('base64')}` };
  }
  if (buf.length > 200 * 1024 || buf.includes(0)) throw new Error(`${name}: 200KB 이하의 텍스트 파일만 첨부할 수 있습니다`);
  return { name, text: buf.toString('utf8') };
}

// ---------- actions callable from the renderer ----------

const actions = {
  // extra: { threadOf } for a thread reply, { voice } for a voice memo.
  send(convId: string, content: string, attachments: Attachment[] = [], skillId: string | null = null, extra: Partial<Message> = {}) {
    const conv = findConv(convId);
    postUserMessage(conv, { content, attachments, skillId, ...extra });
  },
  stop(convId: string) {
    runtime.running.get(convId)?.abort();
  },
  answerQuestion(convId: string, msgId: string, option: string) {
    const conv = findConv(convId);
    const msg = findMsg(conv, msgId);
    if (msg.card?.type === 'question') msg.card.answer = option;
    postUserMessage(conv, { content: option, ...(msg.threadOf ? { threadOf: msg.threadOf } : {}) });
  },
  // choice: accept | decline | later. Accept/decline lets the bot answer the
  // invite on the calendar once without another approval.
  answerMeeting(convId: string, msgId: string, choice: 'accept' | 'decline' | 'later') {
    const conv = findConv(convId);
    const msg = findMsg(conv, msgId);
    if (msg.card?.type !== 'meeting') return;
    msg.card.answer = choice;
    if (choice === 'later' || !msg.botId) return;
    grants.set(msg.botId, (grants.get(msg.botId) || 0) + 1);
    const title = msg.card.title;
    const verb = choice === 'accept' ? '수락' : '거절';
    const blocked = state.settings.blockAccountWrites !== false;
    postUserMessage(conv, { content: blocked ? `"${title}" 회의는 ${verb}하기로 했어요. 캘린더 응답은 내가 직접 할게요.` : `"${title}" 회의를 ${verb}할게요. 캘린더에 ${verb}으로 응답해 주세요.` });
  },
  resolveApproval(id: string, decision: 'allow' | 'deny' | 'always', args?: Record<string, unknown>) {
    approvals.get(id)?.(decision, args);
  },
  toggleReaction(convId: string, msgId: string, emoji: string) {
    const msg = findMsg(findConv(convId), msgId);
    const list = msg.reactions || [];
    msg.reactions = list.includes(emoji) ? list.filter((e) => e !== emoji) : [...list, emoji];
  },
  micAccess(): boolean | Promise<boolean> {
    return process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true;
  },
  // Voice memo (16 kHz WAV data URL) to text, on device.
  async transcribe(wavDataUrl: string): Promise<string> {
    const dir = path.join(dataDir(), 'voice');
    fs.mkdirSync(dir, { recursive: true });
    const wav = path.join(dir, 'memo.wav');
    fs.writeFileSync(wav, Buffer.from(wavDataUrl.split(',')[1], 'base64'));
    const text = await runStt(wav).catch((err: Error) => { throw new Error(`음성을 텍스트로 바꾸지 못했어요: ${err.message}`); });
    if (!text) throw new Error('음성을 알아듣지 못했어요');
    return text;
  },
  acceptSkill(convId: string, msgId: string) {
    const card = findMsg(findConv(convId), msgId).card;
    if (card?.type !== 'skill') return;
    addSkill(card);
    card.saved = true;
  },
  saveSkill(skill: { id?: string; name: string; description: string; body: string }): string {
    if (!skill.id) return addSkill(skill).id;
    Object.assign(findIn(state.skills, skill.id), { name: skill.name, description: skill.description, body: skill.body });
    return skill.id;
  },
  deleteSkill(id: string) {
    state.skills = state.skills.filter((s) => s.id !== id);
    for (const bot of state.bots) bot.skillIds = bot.skillIds.filter((x) => x !== id);
  },
  createBot(name?: string, look: Partial<Bot> = {}): string {
    const bot: Bot = { ...store.newBot(name || `Bot ${state.bots.length + 1}`, state.bots.length), ...withImageColor(look) };
    bot.serverIds = state.mcpServers.map((s) => s.id);
    bot.skillIds = state.skills.map((s) => s.id);
    state.bots.push(bot);
    const conv = store.newConv('dm', [bot.id]);
    state.convs.push(conv);
    return conv.id;
  },
  updateBot(id: string, patch: Partial<Bot>) {
    Object.assign(getBot(id), withImageColor(patch));
  },
  setMainBot(id: string) {
    if (findBot(id)) state.settings.mainBotId = id;
  },
  deleteBot(id: string) {
    if (id === mainBot()?.id) throw new Error('메인 Bot은 삭제할 수 없어요. 먼저 다른 Bot을 메인 Bot으로 지정하세요');
    state.bots = state.bots.filter((b) => b.id !== id);
    state.convs = state.convs.filter((c) => !(c.kind === 'dm' && c.botIds[0] === id));
    for (const c of state.convs) c.botIds = c.botIds.filter((b) => b !== id);
    state.routines = state.routines.filter((r) => r.botId !== id);
  },
  createGroup(name: string, botIds: string[]): string {
    if (botIds.length < 2) throw new Error('그룹 채팅에는 Bot이 2개 이상 필요합니다');
    const conv = store.newConv('group', botIds, name || botIds.map((id) => getBot(id).name).join(', '));
    state.convs.push(conv);
    return conv.id;
  },
  // ----- sidebar sections -----
  createSection(name?: string, convId?: string): string {
    const section: Section = { id: store.id('sec'), name: name || '새 섹션', collapsed: false };
    state.sections.push(section);
    if (convId) findConv(convId).sectionId = section.id;
    return section.id;
  },
  updateSection(id: string, patch: Partial<Section>) {
    Object.assign(findIn(state.sections, id), patch);
  },
  deleteSection(id: string) {
    state.sections = state.sections.filter((x) => x.id !== id);
    for (const c of state.convs) if (c.sectionId === id) delete c.sectionId;
  },
  updateConv(id: string, patch: Partial<Conv>) {
    Object.assign(findConv(id), patch);
  },
  clearConv(id: string) {
    Object.assign(findConv(id), { messages: [], sessions: {}, summary: null });
  },
  // Every bot starts a fresh session next turn, primed with the summary.
  compactConv(id: string) {
    findConv(id).sessions = {};
  },
  deleteConv(id: string) {
    runtime.running.get(id)?.abort();
    state.convs = state.convs.filter((c) => c.id !== id);
    state.routines = state.routines.filter((r) => r.convId !== id);
  },
  addMemory(botId: string, text: string) {
    getBot(botId).memories.push({ id: store.id('mem'), text, ts: Date.now() });
  },
  // CSV import: [{ name, role, label, model }]
  importBots(list: { name: string; role?: string; label?: string; model?: string }[]): number {
    for (const b of list.slice(0, 50)) {
      const bot = getBot(findConv(actions.createBot(b.name)).botIds[0]);
      Object.assign(bot, { ...(b.role ? { systemPrompt: b.role } : {}), ...(b.label ? { label: b.label } : {}), ...(b.model ? { model: b.model } : {}) });
    }
    return Math.min(list.length, 50);
  },
  addMemories(botId: string, texts: string[]): number {
    const bot = getBot(botId);
    for (const text of texts.slice(0, 200)) bot.memories.push({ id: store.id('mem'), text, ts: Date.now() });
    return Math.min(texts.length, 200);
  },
  updateMemory(botId: string, memId: string, text: string) {
    const mem = getBot(botId).memories.find((m) => m.id === memId);
    if (mem) Object.assign(mem, { text, ts: Date.now() });
  },
  deleteMemory(botId: string, memId: string) {
    const bot = getBot(botId);
    bot.memories = bot.memories.filter((m) => m.id !== memId);
  },
  updateSettings(patch: Partial<Settings>) {
    Object.assign(state.settings, patch);
    if (patch.theme) nativeTheme.themeSource = patch.theme; // native menus, scrollbars, dialogs
  },
  // ----- LLM providers (settings › 모델) -----
  refreshClaude,
  async connectClaude() {
    const status = await refreshClaude();
    if (!status.loggedIn) {
      claudeStatus = { ...status, checking: true };
      broadcast();
      try {
        claudeStatus = await providers.claudeLogin();
      } catch (err) {
        const message = (err as Error).message;
        claudeStatus = { loggedIn: false, error: message };
        throw new Error(`Claude 로그인 실패: ${message}`);
      }
    }
    if (!state.settings.providers.some((p) => p.kind === 'claude')) state.settings.providers.unshift({ id: 'claude', kind: 'claude', name: 'Claude' });
    state.settings.provider = state.settings.providers.find((p) => p.kind === 'claude')?.id || 'claude';
    refreshModels();
  },
  addProvider({ kind, name, baseUrl, key }: { kind: Provider['kind']; name?: string; baseUrl?: string; key: string }) {
    if (!key) throw new Error('키를 입력하세요');
    if (kind === 'custom' && !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$))/.test(baseUrl || '')) throw new Error('Base URL은 https:// 로 시작해야 해요 (localhost만 http 허용)');
    const provider: Provider = { id: store.id('prov'), kind, name: name || providers.KINDS[kind].title, ...(kind === 'custom' ? { baseUrl } : {}) };
    state.settings.providers.push(provider);
    writeSecrets({ ...readSecrets(), [`__provider_${provider.id}`]: key });
    state.settings.provider = provider.id;
    refreshModels();
  },
  setProvider(id: string) {
    state.settings.provider = id;
    refreshModels();
  },
  removeProvider(id: string) {
    state.settings.providers = state.settings.providers.filter((p) => p.id !== id);
    const { [`__provider_${id}`]: _, ...rest } = readSecrets();
    writeSecrets(rest);
    if (state.settings.provider === id) state.settings.provider = state.settings.providers[0]?.id || '';
    refreshModels();
  },
  refreshChatgpt,
  async connectChatgpt() {
    if (!(await refreshChatgpt()).loggedIn) {
      chatgptStatus = { checking: true };
      broadcast();
      try {
        chatgptStatus = await imagegen.login();
      } catch (err) {
        const message = (err as Error).message;
        chatgptStatus = { loggedIn: false, error: message };
        throw new Error(`ChatGPT 로그인 실패: ${message}`);
      }
    }
    state.settings.chatgpt = true;
    openaiModels = imagegen.models(codexHome());
    return true;
  },
  // ChatGPT bots on an OpenAI API key instead of a subscription.
  async connectChatgptKey(key: string) {
    if (!/^sk-[\w-]{20,}$/.test(key.trim())) throw new Error('OpenAI API 키 형식이 아닙니다 (sk-로 시작)');
    chatgptStatus = await imagegen.loginWithKey(key.trim());
    if (!chatgptStatus.loggedIn) throw new Error('OpenAI API 키로 로그인하지 못했습니다');
    state.settings.chatgpt = true;
    openaiModels = imagegen.models(codexHome());
    return true;
  },
  // First-run setup is done; bots run on ChatGPT when Claude isn't connected.
  finishOnboarding() {
    const claudeReady = claudeStatus?.loggedIn || state.settings.providers.some((p) => p.kind !== 'claude' && providerKey(readSecrets(), p.id));
    if (!claudeReady && openaiModels[0]) for (const bot of state.bots) if (!bot.model) bot.model = openaiModels[0].value;
    state.settings.onboarded = true;
  },
  async logoutChatgpt() {
    await imagegen.logout();
    return refreshChatgpt();
  },
  removeChatgpt() {
    state.settings.chatgpt = false;
    openaiModels = [];
  },
  // Profile icon in the app's style, made on ChatGPT. source: data URL of the image to
  // reinterpret (optional); resolves with a 256px PNG data URL.
  async generateIcon({ source, note }: { source?: string; note?: string }): Promise<string> {
    if (!chatgptStatus?.loggedIn) throw new Error('설정 › 모델에서 ChatGPT를 먼저 연결하세요');
    const dir = path.join(dataDir(), 'icons');
    fs.mkdirSync(dir, { recursive: true });
    let file: string | null = null;
    if (source) {
      const img = nativeImage.createFromDataURL(source);
      if (img.isEmpty()) throw new Error('이미지를 읽지 못했어요');
      file = path.join(dir, 'source.png');
      fs.writeFileSync(file, img.toPNG());
    }
    const out = await imagegen.generate({ source: file, note }, dir, codexHome());
    return nativeImage.createFromPath(out).resize({ width: 256, height: 256, quality: 'best' }).toDataURL();
  },
  // ----- connecting apps -----
  // Remote servers are tried without a token first; only a 401 (or a host that
  // always needs sign-in, like Google) starts the browser OAuth flow.
  async connectApp(id: string): Promise<{ connected?: boolean; needsClient?: string }> {
    const server = findIn(state.mcpServers, id);
    if (!server.url || server.headers?.Authorization) return { connected: true };
    if (!server.oauth) {
      const known = oauth.configFor(server.url);
      if (known) server.oauth = known;
      else {
        try {
          await mcp.probe(server, userSecretsFrom(readSecrets()));
          return { connected: true };
        } catch (err) {
          if (!mcp.unauthorized(err)) throw new Error(`연결하지 못했어요: ${(err as Error).message}`);
          server.oauth = {};
        }
      }
      syncMcp(); // now shown as "로그인이 필요해요" until signed in
    }
    if (server.oauth.provider === 'google' && !readSecrets().__google_client) return { needsClient: 'google' };
    await actions.connectMcp(id);
    return { connected: true };
  },
  async connectMcp(id: string): Promise<boolean> {
    const server = findIn(state.mcpServers, id);
    const secrets = readSecrets();
    const client = oauthClient(server, secrets);
    const rec: OauthRecord = {};
    await oauth.connect(server, rec, saveOauth(id, rec), client, (url) => shell.openExternal(url));
    syncMcp();
    return true;
  },
  disconnectMcp(id: string) {
    const secrets = readSecrets();
    const { [id]: _, ...rest } = secrets.__oauth || {};
    writeSecrets({ ...secrets, __oauth: rest });
  },
  // Reads the client_secret_*.json file the Google Cloud console downloads.
  async importGoogleClient(): Promise<boolean> {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow(), { title: 'Google OAuth 클라이언트 JSON', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (canceled) return false;
    const json = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    const c = json.web || json.installed;
    if (!c?.client_id) throw new Error('Google OAuth 클라이언트 JSON 파일이 아니에요');
    return actions.setGoogleClient(c.client_id, c.client_secret || '');
  },
  setGoogleClient(clientId: string, clientSecret: string): boolean {
    if (!clientId.trim()) throw new Error('클라이언트 ID를 입력하세요');
    writeSecrets({ ...readSecrets(), __google_client: { client_id: clientId.trim(), client_secret: clientSecret.trim() || undefined } });
    return true;
  },
  setSecret(name: string, value: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('시크릿 이름은 영문, 숫자, _만 쓸 수 있습니다');
    writeSecrets({ ...readSecrets(), [name]: value });
  },
  deleteSecret(name: string) {
    const { [name]: _, ...rest } = readSecrets();
    writeSecrets(rest);
  },
  // Accepts Claude-desktop style `{ "mcpServers": { name: {...} } }` JSON.
  addMcpJson(text: string): boolean {
    const parsed = JSON.parse(text);
    const servers: Record<string, ServerInput> = parsed.mcpServers || parsed;
    for (const [name, cfg] of Object.entries(servers)) addServer({ name, ...cfg });
    syncMcp();
    return true;
  },
  addMcpServer(cfg: ServerInput): string {
    const server = addServer(cfg);
    syncMcp();
    return server.id;
  },
  updateMcpServer(id: string, patch: Partial<McpServer>) {
    Object.assign(findIn(state.mcpServers, id), patch);
    syncMcp();
  },
  deleteMcpServer(id: string) {
    state.mcpServers = state.mcpServers.filter((s) => s.id !== id);
    for (const bot of state.bots) bot.serverIds = bot.serverIds.filter((x) => x !== id);
    syncMcp();
  },
  async installPlugin() {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow(), { properties: ['openDirectory'], title: '플러그인 폴더 선택' });
    if (!canceled) installPlugin(filePaths[0]);
  },
  setPluginEnabled,
  removePlugin,
  setRoutineEnabled(id: string, enabled: boolean) {
    const routine = findIn(state.routines, id);
    if (enabled && state.routines.filter((r) => r.enabled).length >= routines.MAX_ENABLED) throw new Error(`활성 루틴은 최대 ${routines.MAX_ENABLED}개입니다`);
    Object.assign(routine, { enabled, failures: 0 });
  },
  // An assistant template: the bot plus the routines that make it proactive.
  createAssistant(name: string, look: Partial<Bot>, routineList: (ScheduleInput & { prompt: string })[] = []): string {
    const convId = actions.createBot(name, look);
    const conv = findConv(convId);
    for (const r of routineList) createRoutine(conv, getBot(conv.botIds[0]), r);
    return convId;
  },
  deleteRoutine(id: string) {
    state.routines = state.routines.filter((r) => r.id !== id);
  },
  runRoutineNow(id: string) {
    const routine = findIn(state.routines, id);
    routine.lastRun = Date.now();
    runRoutine(routine, findConv(routine.convId));
  },
  addRule(rule: Omit<Rule, 'id'>) {
    gateway.globToRegExp(rule.tool || '*');
    if (rule.match) new RegExp(rule.match);
    state.rules.push({ id: store.id('rule'), ...rule });
  },
  deleteRule(id: string) {
    state.rules = state.rules.filter((r) => r.id !== id);
  },
  // Plan limits of both subscriptions: Claude (Claude Code) and ChatGPT (Codex).
  async getUsage() {
    const [claude, chatgpt] = await Promise.all([
      activeProvider()?.kind === 'claude' ? agent.fetchUsage(agentEnv(readSecrets()), dataDir()).catch((): ClaudeUsage => ({ available: false })) : { available: false } as ClaudeUsage,
      state.settings.chatgpt && chatgptStatus?.loggedIn ? imagegen.usage(codexHome()).catch(() => null) : null,
    ]);
    return { ...claude, chatgpt };
  },
  // Wipes every bot's workspace (its files). The renderer confirms first.
  resetComputers() {
    fs.rmSync(path.join(dataDir(), 'workspaces'), { recursive: true, force: true });
    for (const c of state.convs) c.sessions = {};
  },
  addReviewRule(when: string, effect: Effect) {
    if (!when.trim()) throw new Error('규칙 내용을 입력하세요');
    state.settings.reviewRules.push({ id: store.id('rr'), when: when.trim(), effect });
  },
  deleteReviewRule(id: string) {
    state.settings.reviewRules = state.settings.reviewRules.filter((r) => r.id !== id);
  },
  hostInfo() {
    return {
      host: os.hostname(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      version: app.getVersion(),
      electron: process.versions.electron,
      sdk: JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')).version as string,
    };
  },
  // Latest published Claude Agent SDK, so the user knows when to `npm update`.
  async checkUpdates(): Promise<string> {
    const res = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest');
    if (!res.ok) throw new Error(`업데이트 확인 실패 (${res.status})`);
    return (await res.json()).version;
  },
  async logoutClaude() {
    await providers.claudeLogout();
    return refreshClaude();
  },
  clearAudit() {
    state.audit = [];
  },
  listFiles(botId: string) {
    return tools.listFiles(workspace(botId));
  },
  // In-app viewer: what the library shows when a file is clicked.
  readFile(botId: string, rel: string): { kind: string; name: string; dataUrl?: string; url?: string; ext?: string; text?: string } {
    const full = tools.inside(workspace(botId), rel);
    const ext = path.extname(full).toLowerCase();
    const { size } = fs.statSync(full);
    const name = path.basename(full);
    if ((IMAGE_TYPES[ext] || ext === '.svg') && size < 20 * 1024 * 1024) {
      return { kind: 'image', name, dataUrl: `data:${IMAGE_TYPES[ext] || 'image/svg+xml'};base64,${fs.readFileSync(full).toString('base64')}` };
    }
    if (ext === '.html' || ext === '.htm') return { kind: 'html', name, url: pathToFileURL(full).href };
    if (size > 2 * 1024 * 1024) return { kind: 'other', name };
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return { kind: 'other', name };
    const kind = ({ '.md': 'markdown', '.markdown': 'markdown', '.csv': 'table', '.tsv': 'table' } as Record<string, string>)[ext] || 'text';
    return { kind, name, ext, text: buf.toString('utf8') };
  },
  openFile(botId: string, rel: string) {
    return shell.openPath(tools.inside(workspace(botId), rel));
  },
  revealWorkspace(botId: string) {
    return shell.openPath(workspace(botId));
  },
  async pickAttachments() {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow(), { properties: ['openFile', 'multiSelections'] });
    return canceled ? [] : filePaths.map(readAttachment);
  },
  async exportBot(id: string) {
    const bot = getBot(id);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow(), { defaultPath: `${bot.name}.characterbot.json` });
    if (canceled || !filePath) return;
    const skills = state.skills.filter((s) => bot.skillIds.includes(s.id)).map(({ name, description, body }) => ({ name, description, body }));
    const { name, label, color, systemPrompt: prompt, model } = bot;
    fs.writeFileSync(filePath, JSON.stringify({ characterbotTemplate: 1, name, label, color, systemPrompt: prompt, model, skills }, null, 2));
  },
  async importBot(): Promise<string | null> {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow(), { filters: [{ name: 'Bot 템플릿', extensions: ['json'] }] });
    if (canceled) return null;
    const tpl = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (tpl.characterbotTemplate !== 1) throw new Error('Bot 템플릿 파일이 아닙니다');
    const convId = actions.createBot(tpl.name);
    const bot = getBot(findConv(convId).botIds[0]);
    Object.assign(bot, { label: tpl.label || '', color: tpl.color || bot.color, systemPrompt: tpl.systemPrompt, model: tpl.model || '' });
    for (const s of (tpl.skills || []) as { name: string; description?: string; body?: string }[]) {
      const existing = state.skills.find((x) => x.name === s.name);
      if (existing) { if (!bot.skillIds.includes(existing.id)) bot.skillIds.push(existing.id); } else addSkill(s);
    }
    return convId;
  },
};
export type Actions = typeof actions;

// Queries that change nothing; broadcasting after them would re-render the
// panel, which queries again (the library tab flicker loop).
const QUERIES = new Set<string>(['listFiles', 'hostInfo', 'getUsage', 'checkUpdates', 'openFile', 'revealWorkspace', 'generateIcon', 'readFile', 'micAccess', 'transcribe']);
ipcMain.handle('act', async (_e, name: keyof Actions, ...args: unknown[]) => {
  const fn = actions[name] as (...a: unknown[]) => unknown;
  if (typeof fn !== 'function') throw new Error(`알 수 없는 동작: ${String(name)}`);
  const result = await fn(...args);
  if (!QUERIES.has(name)) { broadcast(); syncTriggers(); }
  return result;
});
ipcMain.handle('init', () => {
  broadcast();
  return true;
});

// ---------- app lifecycle ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 600,
    title: 'PixelBot',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Links in bot replies open in the browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  const legacy = path.join(dataDir(), 'agents.json');
  state = store.load(fs.existsSync(stateFile()) || !fs.existsSync(legacy) ? stateFile() : legacy);
  nativeTheme.themeSource = state.settings.theme;
  state.sections ||= [];
  for (const bot of state.bots) if (bot.image) bot.color = imageColor(bot.image) || bot.color;
  syncMcp();
  refreshClaude();
  refreshChatgpt();
  refreshModels();
  createWindow();
  setInterval(tickRoutines, 30_000);
  syncTriggers();
});
app.on('before-quit', () => {
  clearTimeout(saveTimer);
  store.save(stateFile(), state);
});
app.on('window-all-closed', () => app.quit());
