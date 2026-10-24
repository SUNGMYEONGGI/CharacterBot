// The user's ChatGPT subscription through the Codex SDK: image generation and
// bot turns on ChatGPT models.
// Codex signs in with ChatGPT (OAuth) and has a built-in image_gen tool; images it
// makes land in $CODEX_HOME/generated_images/<thread id>/.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { BOT_ICON_PROMPT } = require('./iconprompt.cjs');

// Plan names as ChatGPT shows them (the API calls Pro "prolite").
const PLANS = { prolite: 'Pro', pro: 'Pro', plus: 'Plus', free: 'Free', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };
const planName = (p) => PLANS[p] || p || '';

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

function codexBin() {
  const triple = { arm64: 'aarch64', x64: 'x86_64' }[process.arch];
  try {
    return require.resolve(`@openai/codex-${process.platform}-${process.arch}/vendor/${triple}-apple-darwin/bin/codex`).replace('app.asar', 'app.asar.unpacked');
  } catch {
    return 'codex';
  }
}

function run(args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(codexBin(), args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').pop()));
      else resolve(`${stdout}${stderr}`);
    });
  });
}

// { loggedIn, email, plan } for this computer's Codex (ChatGPT) login.
async function status() {
  const out = await run(['login', 'status'], 20_000).catch(() => '');
  if (!/ChatGPT/.test(out)) return { loggedIn: false };
  try {
    const { tokens } = JSON.parse(fs.readFileSync(path.join(codexHome(), 'auth.json'), 'utf8'));
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url'));
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

// Makes one Grok Bot style icon. source: optional local image path to reinterpret;
// note: optional extra request. Resolves with the generated PNG's path.
async function generate({ source, note }, cwd, home) {
  const { Codex } = await import('@openai/codex-sdk');
  const codex = new Codex({ codexPathOverride: codexBin(), env: { ...process.env, CODEX_HOME: botHome(home) }, config: { developer_instructions: BOT_ICON_PROMPT } });
  const thread = codex.startThread({ workingDirectory: cwd, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never' });
  const ask = [
    source ? '첨부한 이미지 속 대상을 Grok bot icon으로 변환해 주세요.' : '아래 설명의 캐릭터를 Grok bot icon으로 만들어 주세요.',
    note ? `추가 요청: ${note}` : '',
    '내장 image_gen 도구를 바로 한 번 호출해 아이콘 한 장만 생성하세요. 파일을 읽거나 명령을 실행하지 마세요.',
  ].filter(Boolean).join('\n');
  const turn = await thread.run(source ? [{ type: 'text', text: ask }, { type: 'local_image', path: source }] : ask);
  const dir = path.join(home, 'generated_images', thread.id || '');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
  if (!files.length) throw new Error(turn.finalResponse?.trim() || '이미지를 만들지 못했어요');
  return path.join(dir, files.map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]).sort((a, b) => b[1] - a[1])[0][0]);
}

// ChatGPT models this login offers (Codex's model cache), as picker entries.
function models(home) {
  for (const dir of [home, codexHome()]) {
    try {
      const cache = JSON.parse(fs.readFileSync(path.join(dir, 'models_cache.json'), 'utf8'));
      return cache.models.filter((m) => m.visibility === 'list')
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
function botHome(home) {
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
// appTools: { url, token } of the Grok Bot tools' MCP endpoint (optional).
async function runTurn({ home, threadId, prompt, images, cwd, model, instructions, sandbox, additionalDirectories, appTools, signal, on }) {
  const { Codex } = await import('@openai/codex-sdk');
  const config = { developer_instructions: instructions };
  if (appTools) {
    config.mcp_servers = { grokbot: { url: appTools.url, bearer_token_env_var: 'GROKBOT_TOOLS_TOKEN', default_tools_approval_mode: 'approve' } };
  }
  const codex = new Codex({
    codexPathOverride: codexBin(),
    env: { ...process.env, CODEX_HOME: botHome(home), ...(appTools ? { GROKBOT_TOOLS_TOKEN: appTools.token } : {}) },
    config,
  });
  const opts = {
    model, workingDirectory: cwd, skipGitRepoCheck: true, sandboxMode: sandbox, approvalPolicy: 'never',
    networkAccessEnabled: true, webSearchMode: 'live', additionalDirectories,
  };
  const thread = threadId ? codex.resumeThread(threadId, opts) : codex.startThread(opts);
  const { events } = await thread.runStreamed([{ type: 'text', text: prompt || '(첨부 파일)' }, ...images.map((p) => ({ type: 'local_image', path: p }))], { signal });
  for await (const event of events) on(event);
  return thread.id;
}

// ChatGPT plan rate limits, read from Codex's app server (JSON-RPC over stdio).
// Resolves with { plan, windows: [{ title, usedPercent, resetsAt (ms) }] }.
function usage(home) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexBin(), ['app-server'], { env: { ...process.env, CODEX_HOME: botHome(home) } });
    const done = (fn, v) => { clearTimeout(timer); child.kill(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('응답 없음')), 20_000);
    let buf = '';
    child.on('error', (err) => done(reject, err));
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== 2) continue;
        if (msg.error) return done(reject, new Error(msg.error.message));
        const r = msg.result.rateLimits || {};
        const title = (mins) => (mins === 10080 ? '주간' : mins >= 1440 ? `${Math.round(mins / 1440)}일` : `${Math.round(mins / 60)}시간`);
        const windows = [r.secondary, r.primary].filter(Boolean)
          .map((w) => ({ title: title(w.windowDurationMins), minutes: w.windowDurationMins, usedPercent: w.usedPercent, resetsAt: w.resetsAt * 1000 }))
          .sort((a, b) => a.minutes - b.minutes);
        return done(resolve, { plan: planName(r.planType), windows });
      }
    });
    const send = (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'grokbot', version: '0.1.0' } } });
    send({ method: 'initialized' });
    send({ id: 2, method: 'account/rateLimits/read' });
  });
}

module.exports = { status, login, logout, generate, models, runTurn, usage };
