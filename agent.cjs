// Runs one bot turn on the Claude Agent SDK (Claude Code as a library).
// Auth comes from the local Claude Code login unless an API key is passed in env.
let sdk;
const loadSdk = () => (sdk ||= Promise.all([import('@anthropic-ai/claude-agent-sdk'), import('zod')]));

// In a packaged app the Claude Code binary sits in app.asar.unpacked, where it can run.
function claudeBin() {
  try {
    return require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`).replace('app.asar', 'app.asar.unpacked');
  } catch {
    return undefined;
  }
}
const query = (agentSdk, { prompt, options }) => agentSdk.query({ prompt, options: { pathToClaudeCodeExecutable: claudeBin(), ...options } });

// opts: { prompt, images, sessionId, cwd, model, systemPrompt, env, mcpServers,
//         signal, gate(call) -> { effect, reason, updatedInput? }, appServer(sdk, z), onMessage(m) }
async function runTurn(opts) {
  const [agentSdk, { z }] = await loadSdk();
  const abortController = new AbortController();
  if (opts.signal.aborted) abortController.abort();
  opts.signal.addEventListener('abort', () => abortController.abort(), { once: true });

  const content = [
    { type: 'text', text: opts.prompt || '(첨부 파일)' },
    ...opts.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })),
  ];
  async function* input() {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  }

  // The hook is the single gate every tool call passes, including subagents'.
  const preToolUse = async (hookInput) => {
    const decision = await opts.gate({ id: hookInput.tool_use_id, name: hookInput.tool_name, args: hookInput.tool_input || {} });
    // An approved draft the user edited goes out as edited.
    const updated = decision.updatedInput ? { updatedInput: decision.updatedInput } : {};
    if (decision.note) updated.additionalContext = decision.note;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision.effect, permissionDecisionReason: decision.reason, ...updated } };
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
      mcpServers: { ...opts.mcpServers, grokbot: opts.appServer(agentSdk, z) },
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'],
      hooks: { PreToolUse: [{ hooks: [preToolUse], timeout: 3600 }] },
      // Everything is decided by the hook; anything that still falls through is refused.
      canUseTool: async () => ({ behavior: 'deny', message: '게이트웨이가 승인하지 않은 도구입니다' }),
    },
  });
  for await (const message of q) opts.onMessage(message);
}

// Asks a small model which natural-language review rules an action falls under.
// Returns the matching rule indices (0-based).
async function judgeRules({ rules, call, env }) {
  const [agentSdk] = await loadSdk();
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
  return matches.map((n) => n - 1).filter((i) => rules[i]);
}

// Condenses older chat history so a fresh session doesn't replay all of it.
async function summarize({ previous, text, env }) {
  const [agentSdk] = await loadSdk();
  const prompt = `아래 대화 기록을 이어받을 AI가 읽을 요약으로 정리하세요. 결정된 사항, 사용자의 요청과 선호, 진행 중인 작업과 남은 할 일, 중요한 사실(이름·숫자·파일 경로)을 빠짐없이 남기고 잡담은 빼세요. 기록에 없는 추측·보충 설명은 쓰지 마세요. 제목 없이 한국어 불릿으로 2000자 이내.
${previous ? `\n지금까지의 요약:\n${previous}\n` : ''}
이어지는 대화:
${text}`;
  let out = '';
  for await (const m of query(agentSdk, { prompt, options: { model: 'haiku', tools: [], settingSources: [], maxTurns: 1, env, cwd: require('node:os').tmpdir(), systemPrompt: '대화 기록을 요약하는 도구입니다. 요약만 출력하세요.' } })) {
    if (m.type === 'result' && m.subtype === 'success') out = m.result;
  }
  if (!out) throw new Error('요약 실패');
  return out.trim();
}

// Runs `fn(q)` against an SDK session that never sends a prompt — for metadata
// calls (usage, models) that cost nothing.
async function idleQuery(env, cwd, fn) {
  const [agentSdk] = await loadSdk();
  const ac = new AbortController();
  async function* idle() {
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
function fetchUsage(env, cwd) {
  return idleQuery(env, cwd, async (q) => {
    const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    return { plan: u.subscription_type, available: u.rate_limits_available, fiveHour: u.rate_limits?.five_hour || null, sevenDay: u.rate_limits?.seven_day || null };
  });
}

// Models the current provider offers, with versioned names ("Opus 5.5").
function fetchModels(env, cwd) {
  return idleQuery(env, cwd, async (q) => (await q.supportedModels()).map((m) => ({
    value: m.value === 'default' ? '' : m.value,
    name: m.value === 'default' ? m.description.split(' · ')[0] : m.displayName,
    description: m.value === 'default' ? m.description.split(' · ').slice(1).join(' · ') : m.description,
    id: m.resolvedModel || m.value,
  })));
}

// Text of a tool_result block's content (string or content-block array).
function resultText(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
}

module.exports = { runTurn, resultText, judgeRules, summarize, fetchUsage, fetchModels };
