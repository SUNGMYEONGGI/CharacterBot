// LLM providers the bots run on. Every provider goes through the Claude Agent SDK;
// they differ only in how the SDK authenticates:
//   claude    – Claude subscription, signed in with the Claude Code OAuth login
//   anthropic – Anthropic API key
//   custom    – any Anthropic-compatible endpoint (base URL + key)
import { execFile } from 'node:child_process';
import type { LoginStatus, Provider } from '../shared/types';

const KINDS: Record<Provider['kind'], { title: string; sub: string; group: string }> = {
  claude: { title: 'Claude', sub: 'Subscription', group: 'Subscription' },
  anthropic: { title: 'Anthropic', sub: 'API', group: 'API' },
  custom: { title: '사용자 지정', sub: 'API', group: 'API' },
};

// The SDK ships its own Claude Code binary; fall back to one on PATH.
function claudeBin() {
  try {
    return require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`).replace('app.asar', 'app.asar.unpacked');
  } catch {
    return 'claude';
  }
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  return env;
}

function run(args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(claudeBin(), args, { env: cleanEnv(), timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').pop() || err.message));
      else resolve(stdout);
    });
  });
}

// { loggedIn, email, plan } for the Claude Code login on this computer.
async function claudeStatus(): Promise<LoginStatus & { org: string }> {
  const s = JSON.parse(await run(['auth', 'status', '--json'], 20_000));
  const subscription = s.loggedIn && s.authMethod === 'claude.ai';
  return { loggedIn: subscription, email: s.email || '', plan: s.subscriptionType || '', org: s.orgName || '' };
}

// Opens the browser for the Claude OAuth sign-in and waits for it to finish.
async function claudeLogin(email?: string) {
  await run(['auth', 'login', '--claudeai', ...(email ? ['--email', email] : [])], 10 * 60_000);
  return claudeStatus();
}

// Signs this computer's Claude Code out (the CLI shares the same login).
const claudeLogout = () => run(['auth', 'logout'], 20_000);

// Environment for an SDK query on `provider`. `key` is the provider's stored secret.
function env(base: NodeJS.ProcessEnv, provider: Provider | undefined, key: string | undefined): NodeJS.ProcessEnv {
  const out = { ...base };
  delete out.ANTHROPIC_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  delete out.ANTHROPIC_BASE_URL;
  if (!provider || provider.kind === 'claude') return out;
  if (!key) throw new Error(`${provider.name} 키가 없습니다. 설정 › 모델에서 연결하세요.`);
  if (provider.kind === 'custom') {
    out.ANTHROPIC_BASE_URL = provider.baseUrl;
    out.ANTHROPIC_AUTH_TOKEN = key;
  } else {
    out.ANTHROPIC_API_KEY = key;
  }
  return out;
}

export { KINDS, claudeStatus, claudeLogin, claudeLogout, env };
