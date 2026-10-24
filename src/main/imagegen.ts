// The user's ChatGPT subscription through the Codex SDK: image generation and
// bot turns on ChatGPT models.
// Codex signs in with ChatGPT (OAuth) and has a built-in image_gen tool; images it
// makes land in $CODEX_HOME/generated_images/<thread id>/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import type { CodexOptions, SandboxMode, ThreadEvent, ThreadOptions, UserInput } from '@openai/codex-sdk';
import type { LoginStatus, ModelInfo } from '../shared/types';
import { BOT_ICON_PROMPT } from './iconprompt';
import type { AppTools } from './tools';

// Plan names as ChatGPT shows them (the API calls Pro "prolite").
const PLANS: Record<string, string> = { prolite: 'Pro', pro: 'Pro', plus: 'Plus', free: 'Free', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };
const planName = (p: string | undefined): string => (p && PLANS[p]) || p || '';

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

function codexBin(): string {
  const triple = ({ arm64: 'aarch64', x64: 'x86_64' } as Record<string, string>)[process.arch];
  try {
    return require.resolve(`@openai/codex-${process.platform}-${process.arch}/vendor/${triple}-apple-darwin/bin/codex`).replace('app.asar', 'app.asar.unpacked');
  } catch {
    return 'codex';
  }
}

function run(args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(codexBin(), args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').pop() || err.message));
      else resolve(`${stdout}${stderr}`);
    });
  });
}

// { loggedIn, email, plan } for this computer's Codex (ChatGPT) login.
async function status(): Promise<LoginStatus> {
  const out = await run(['login', 'status'], 20_000).catch(() => '');
  if (!/ChatGPT/.test(out)) return { loggedIn: false };
  try {
    const { tokens } = JSON.parse(fs.readFileSync(path.join(codexHome(), 'auth.json'), 'utf8'));
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
    const plan = claims['https://api.openai.com/auth']?.chatgpt_plan_type || '';
    return { loggedIn: true, email: claims.email || '', plan: planName(plan) };
  } catch {
    return { loggedIn: true, email: '', plan: '' };
  }
}

// Opens the browser for the ChatGPT sign-in and waits for it to finish.
async function login() {
  await run(['login'], 10 * 60_000);
  return status();
}

const logout = () => run(['logout'], 20_000);

// Makes one profile icon in the app's style. source: optional local image path to reinterpret;
// note: optional extra request. Resolves with the generated PNG's path.
async function generate({ source, note }: { source: string | null; note?: string }, cwd: string, home: string): Promise<string> {
  const { Codex } = await import('@openai/codex-sdk');
  const codex = new Codex({ codexPathOverride: codexBin(), env: { ...process.env, CODEX_HOME: botHome(home) }, config: { developer_instructions: BOT_ICON_PROMPT } });
  const thread = codex.startThread({ workingDirectory: cwd, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never' });
  const ask = [
    source ? '첨부한 이미지 속 대상을 CharacterBot 아이콘으로 바꿔 주세요.' : '아래 설명의 캐릭터를 CharacterBot 아이콘으로 만들어 주세요.',
    note ? `추가 요청: ${note}` : '',
    '내장 image_gen 도구를 바로 한 번 호출해 아이콘 한 장만 생성하세요. 파일을 읽거나 명령을 실행하지 마세요.',
  ].filter(Boolean).join('\n');
  const turn = await thread.run(source ? [{ type: 'text', text: ask }, { type: 'local_image', path: source }] : ask);
  const dir = path.join(home, 'generated_images', thread.id || '');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
  if (!files.length) throw new Error(turn.finalResponse?.trim() || '이미지를 만들지 못했어요');
  const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  return path.join(dir, newest.f);
}

// ChatGPT models this login offers (Codex's model cache), as picker entries.
interface CachedModel {
  slug: string;
  display_name: string;
  description: string;
  visibility: string;
  priority: number;
}

function models(home: string): ModelInfo[] {
  for (const dir of [home, codexHome()]) {
    try {
      const cache = JSON.parse(fs.readFileSync(path.join(dir, 'models_cache.json'), 'utf8'));
      return (cache.models as CachedModel[]).filter((m) => m.visibility === 'list')
        .sort((a, b) => a.priority - b.priority)
        .map((m) => ({ value: `openai:${m.slug}`, name: m.display_name, description: m.description, id: m.slug }));
    } catch {}
  }
  return [];
}

// Nothing that reaches the user's real accounts or screen: no ChatGPT apps
// (connectors), plugins, computer use or the user's browser.
const BOT_CONFIG = `[features]
apps = false
plugins = false
remote_plugin = false
computer_use = false
browser_use = false
browser_use_external = false
in_app_browser = false
memories = false
`;

// Bots get their own CODEX_HOME so the user's Codex setup (AGENTS.md, plugins,
// MCP servers, hooks) stays out. The login is shared: auth.json is a symlink to
// the user's, and if Codex ever replaces the link, the newer token goes back.
function botHome(home: string): string {
  fs.mkdirSync(home, { recursive: true });
  const link = path.join(home, 'auth.json');
  const real = path.join(codexHome(), 'auth.json');
  const st = fs.lstatSync(link, { throwIfNoEntry: false });
  if (st && !st.isSymbolicLink()) {
    if (st.mtimeMs > fs.statSync(real).mtimeMs) fs.copyFileSync(link, real);
    fs.rmSync(link);
  }
  if (!st || !st.isSymbolicLink()) fs.symlinkSync(real, link);
  fs.writeFileSync(path.join(home, 'config.toml'), BOT_CONFIG);
  return home;
}

// One bot turn on a ChatGPT model. on(event) receives every Codex thread event.
// Resolves with the Codex thread id to resume next time.
// appTools: { url, token } of the app tools' MCP endpoint (optional).
export interface CodexTurn {
  home: string;
  threadId: string | null;
  prompt: string;
  images: string[]; // local file paths
  cwd: string;
  model: string;
  instructions: string;
  sandbox: SandboxMode;
  additionalDirectories: string[];
  appTools?: AppTools;
  signal: AbortSignal;
  on: (event: ThreadEvent) => void;
}

async function runTurn({ home, threadId, prompt, images, cwd, model, instructions, sandbox, additionalDirectories, appTools, signal, on }: CodexTurn): Promise<string | null> {
  const { Codex } = await import('@openai/codex-sdk');
  const config: NonNullable<CodexOptions['config']> = { developer_instructions: instructions };
  if (appTools) {
    config.mcp_servers = { characterbot: { url: appTools.url, bearer_token_env_var: 'CHARACTERBOT_TOOLS_TOKEN', default_tools_approval_mode: 'approve' } };
  }
  const codex = new Codex({
    codexPathOverride: codexBin(),
    env: { ...process.env, CODEX_HOME: botHome(home), ...(appTools ? { CHARACTERBOT_TOOLS_TOKEN: appTools.token } : {}) },
    config,
  });
  const opts: ThreadOptions = {
    model, workingDirectory: cwd, skipGitRepoCheck: true, sandboxMode: sandbox, approvalPolicy: 'never',
    networkAccessEnabled: true, webSearchMode: 'live', additionalDirectories,
  };
  const thread = threadId ? codex.resumeThread(threadId, opts) : codex.startThread(opts);
  const input: UserInput[] = [{ type: 'text', text: prompt || '(첨부 파일)' }, ...images.map((p) => ({ type: 'local_image' as const, path: p }))];
  const { events } = await thread.runStreamed(input, { signal });
  for await (const event of events) on(event);
  return thread.id;
}

// ChatGPT plan rate limits, read from Codex's app server (JSON-RPC over stdio).
// Resolves with { plan, windows: [{ title, usedPercent, resetsAt (ms) }] }.
interface RateWindow {
  windowDurationMins: number;
  usedPercent: number;
  resetsAt: number;
}
export interface ChatgptUsage {
  plan: string;
  windows: { title: string; minutes: number; usedPercent: number; resetsAt: number }[];
}

function usage(home: string): Promise<ChatgptUsage> {
  return new Promise((resolve, reject) => {
    const child = spawn(codexBin(), ['app-server'], { env: { ...process.env, CODEX_HOME: botHome(home) } });
    const done = <T>(fn: (v: T) => void, v: T) => { clearTimeout(timer); child.kill(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('응답 없음')), 20_000);
    let buf = '';
    child.on('error', (err) => done(reject, err));
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== 2) continue;
        if (msg.error) return done(reject, new Error(msg.error.message));
        const r = msg.result.rateLimits || {};
        const title = (mins: number) => (mins === 10080 ? '주간' : mins >= 1440 ? `${Math.round(mins / 1440)}일` : `${Math.round(mins / 60)}시간`);
        const windows = ([r.secondary, r.primary] as (RateWindow | undefined)[]).filter((w): w is RateWindow => Boolean(w))
          .map((w) => ({ title: title(w.windowDurationMins), minutes: w.windowDurationMins, usedPercent: w.usedPercent, resetsAt: w.resetsAt * 1000 }))
          .sort((a, b) => a.minutes - b.minutes);
        return done(resolve, { plan: planName(r.planType), windows });
      }
    });
    const send = (m: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'characterbot', version: '0.1.0' } } });
    send({ method: 'initialized' });
    send({ id: 2, method: 'account/rateLimits/read' });
  });
}

export { status, login, logout, generate, models, runTurn, usage };
