// Runs one bot turn on the Claude Agent SDK (Claude Code as a library).
// Auth comes from the local Claude Code login unless an API key is passed in env.
import os from 'node:os';
import type { McpServerConfig, McpSdkServerConfigWithInstance, Options, PreToolUseHookInput, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Effect, ModelInfo, ReviewRule } from '../shared/types';
import type { Call } from './gateway';
import type { Prompt } from './transcript';

// The SDK is ESM-only; loaded on first use from the CommonJS main bundle.
export type AgentSdk = typeof import('@anthropic-ai/claude-agent-sdk');
let sdk: Promise<AgentSdk> | undefined;
const loadSdk = () => (sdk ||= import('@anthropic-ai/claude-agent-sdk'));

// In a packaged app the Claude Code binary sits in app.asar.unpacked, where it can run.
function claudeBin(): string | undefined {
  try {
    return require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`).replace('app.asar', 'app.asar.unpacked');
  } catch {
    return undefined;
  }
}
const query = (agentSdk: AgentSdk, { prompt, options }: { prompt: string | AsyncIterable<SDKUserMessage>; options: Options }): Query =>
  agentSdk.query({ prompt, options: { pathToClaudeCodeExecutable: claudeBin(), ...options } });

export interface GateResult {
  effect: Effect;
  reason?: string;
  updatedInput?: Record<string, unknown>;
  note?: string;
}

export interface TurnOptions {
  prompt: string;
  images: Prompt['images'];
  sessionId: string | null;
  cwd: string;
  additionalDirectories: string[];
  model: string;
  systemPrompt: string;
  env: NodeJS.ProcessEnv;
  mcpServers: Record<string, McpServerConfig>;
  signal: AbortSignal;
  gate: (call: Call & { id: string }) => Promise<GateResult>;
  appServer: (agentSdk: AgentSdk) => McpSdkServerConfigWithInstance;
  onMessage: (m: SDKMessage) => void;
}

async function runTurn(opts: TurnOptions): Promise<void> {
  const agentSdk = await loadSdk();
  const abortController = new AbortController();
  if (opts.signal.aborted) abortController.abort();
  opts.signal.addEventListener('abort', () => abortController.abort(), { once: true });

  const content = [
    { type: 'text' as const, text: opts.prompt || '(첨부 파일)' },
    ...opts.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType as 'image/png', data: i.data } })),
  ];
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  }

  // The hook is the single gate every tool call passes, including subagents'.
  const preToolUse = async (input: unknown) => {
    const hookInput = input as PreToolUseHookInput;
    const decision = await opts.gate({ id: hookInput.tool_use_id, name: hookInput.tool_name, args: (hookInput.tool_input || {}) as Record<string, unknown> });
    // An approved draft the user edited goes out as edited.
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: decision.effect,
        permissionDecisionReason: decision.reason,
        ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
        ...(decision.note ? { additionalContext: decision.note } : {}),
      },
    };
  };

  const q = query(agentSdk, {
    prompt: input(),
    options: {
      model: opts.model || undefined,
      systemPrompt: opts.systemPrompt,
      cwd: opts.cwd,
      additionalDirectories: opts.additionalDirectories,
      env: opts.env,
      resume: opts.sessionId || undefined,
      abortController,
      includePartialMessages: true,
      // Keep the user's own ~/.claude hooks, CLAUDE.md and plugins out of the bots.
      settingSources: [],
      mcpServers: { ...opts.mcpServers, grokbot: opts.appServer(agentSdk) },
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'],
      hooks: { PreToolUse: [{ hooks: [preToolUse], timeout: 3600 }] },
      // Everything is decided by the hook; anything that still falls through is refused.
      canUseTool: async () => ({ behavior: 'deny' as const, message: '게이트웨이가 승인하지 않은 도구입니다' }),
    },
  });
  for await (const message of q) opts.onMessage(message);
}

// Asks a small model which natural-language review rules an action falls under.
// Returns the matching rule indices (0-based).
async function judgeRules({ rules, call, env }: { rules: ReviewRule[]; call: Call; env: NodeJS.ProcessEnv }): Promise<number[]> {
  const agentSdk = await loadSdk();
  const prompt = `You review actions an AI agent is about to take against the user's rules.
Rules:
${rules.map((r, i) => `${i + 1}. When the agent is about to: ${r.when}`).join('\n')}

Action: tool "${call.name}" with input ${JSON.stringify(call.args).slice(0, 2000)}

Which rules does this action fall under? Reply with only JSON like {"matches":[1,3]} or {"matches":[]}.`;
  let text = '';
  for await (const m of query(agentSdk, { prompt, options: { model: 'haiku', tools: [], settingSources: [], maxTurns: 1, env, systemPrompt: 'Reply with JSON only.' } })) {
    if (m.type === 'result' && m.subtype === 'success') text = m.result;
  }
  const json = text.match(/\{[\s\S]*\}/);
  const matches = json ? JSON.parse(json[0]).matches || [] : [];
  return (matches as number[]).map((n) => n - 1).filter((i) => rules[i]);
}

// Condenses older chat history so a fresh session doesn't replay all of it.
async function summarize({ previous, text, env }: { previous?: string; text: string; env: NodeJS.ProcessEnv }): Promise<string> {
  const agentSdk = await loadSdk();
  const prompt = `아래 대화 기록을 이어받을 AI가 읽을 요약으로 정리하세요. 결정된 사항, 사용자의 요청과 선호, 진행 중인 작업과 남은 할 일, 중요한 사실(이름·숫자·파일 경로)을 빠짐없이 남기고 잡담은 빼세요. 기록에 없는 추측·보충 설명은 쓰지 마세요. 제목 없이 한국어 불릿으로 2000자 이내.
${previous ? `\n지금까지의 요약:\n${previous}\n` : ''}
이어지는 대화:
${text}`;
  let out = '';
  for await (const m of query(agentSdk, { prompt, options: { model: 'haiku', tools: [], settingSources: [], maxTurns: 1, env, cwd: os.tmpdir(), systemPrompt: '대화 기록을 요약하는 도구입니다. 요약만 출력하세요.' } })) {
    if (m.type === 'result' && m.subtype === 'success') out = m.result;
  }
  if (!out) throw new Error('요약 실패');
  return out.trim();
}

// Runs `fn(q)` against an SDK session that never sends a prompt — for metadata
// calls (usage, models) that cost nothing.
async function idleQuery<T>(env: NodeJS.ProcessEnv, cwd: string, fn: (q: Query) => Promise<T>): Promise<T> {
  const agentSdk = await loadSdk();
  const ac = new AbortController();
  async function* idle(): AsyncGenerator<SDKUserMessage> {
    await new Promise((resolve) => ac.signal.addEventListener('abort', resolve));
  }
  const q = query(agentSdk, { prompt: idle(), options: { settingSources: [], abortController: ac, env, cwd } });
  try {
    return await fn(q);
  } finally {
    ac.abort();
  }
}

// Claude plan rate-limit windows (5-hour, weekly) for the logged-in account.
// Uses the SDK's experimental /usage call, so failures just mean "unknown".
export interface ClaudeUsage {
  plan?: string | null;
  available: boolean;
  fiveHour?: UsageWindow | null;
  sevenDay?: UsageWindow | null;
}
export interface UsageWindow {
  utilization?: number | null;
  resets_at?: string | number | null;
}

function fetchUsage(env: NodeJS.ProcessEnv, cwd: string): Promise<ClaudeUsage> {
  return idleQuery(env, cwd, async (q) => {
    const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    return { plan: u.subscription_type, available: u.rate_limits_available, fiveHour: u.rate_limits?.five_hour || null, sevenDay: u.rate_limits?.seven_day || null };
  });
}

// Models the current provider offers, with versioned names ("Opus 5.5").
function fetchModels(env: NodeJS.ProcessEnv, cwd: string): Promise<ModelInfo[]> {
  return idleQuery(env, cwd, async (q) => (await q.supportedModels()).map((m) => ({
    value: m.value === 'default' ? '' : m.value,
    name: m.value === 'default' ? m.description.split(' · ')[0] : m.displayName,
    description: m.value === 'default' ? m.description.split(' · ').slice(1).join(' · ') : m.description,
    id: m.resolvedModel || m.value,
  })));
}

// Text of a tool_result block's content (string or content-block array).
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  return ((content || []) as { type: string; text?: string }[]).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
}

export { runTurn, resultText, judgeRules, summarize, fetchUsage, fetchModels };
