// Every tool call passes through decide() before it runs (a PreToolUse hook)
// and is audited after, mirroring OpenBot's gateway: deny beats allow, and
// anything unmatched falls back to the tool's default effect.

// Bots have full permissions by default, except that a connected (external) app
// asks before anything that isn't a read. The user's rules and per-tool settings
// (e.g. Bash under settings › 컴퓨터) come first.
import type { Effect, Initiator, Rule } from '../shared/types';

export interface Call {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  botId?: string;
  initiator?: Initiator;
}
export interface Decision {
  effect: Effect;
  rule?: Rule | null;
  reason?: string;
}
const APP_READ = /(^|[_-])(list|get|search|read|fetch|query|find|view|describe|lookup|check|status|whoami|me|info|retrieve|download|resolve|suggest)([_-]|$)/i;
function defaultEffect(call: Call, overrides: Record<string, Effect>): Effect {
  if (overrides[call.name]) return overrides[call.name];
  if (call.name.startsWith('mcp__') && !call.name.startsWith('mcp__grokbot__')) {
    return APP_READ.test(call.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')) ? 'allow' : 'ask';
  }
  return 'allow';
}

// A write to an app tied to the user's own account: claude.ai connectors and
// remote (URL/OAuth) servers. remote: tool-name slugs of remote servers.
function accountWrite(name: string, remote: string[] = []): boolean {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  if (!m || m[1] === 'grokbot' || APP_READ.test(m[2])) return false;
  return m[1].startsWith('claude_ai_') || remote.includes(m[1]);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function matches(rule: Rule, call: Call): boolean {
  if (rule.botId && rule.botId !== call.botId) return false;
  if (!globToRegExp(rule.tool || '*').test(call.name)) return false;
  if (rule.match) {
    try {
      if (!new RegExp(rule.match, 'i').test(JSON.stringify(call.args))) return false;
    } catch {
      return false; // A broken pattern never widens access.
    }
  }
  return true;
}

// overrides: per-tool default effects from settings, e.g. { Bash: 'allow' }.
function decide(call: Call, rules: Rule[] = [], overrides: Record<string, Effect> = {}): Decision {
  for (const effect of ['deny', 'allow', 'ask'] as const) {
    const rule = rules.find((r) => r.effect === effect && matches(r, call));
    if (rule) return finalize(effect, rule, call);
  }
  return finalize(defaultEffect(call, overrides), null, call);
}

// Combines the effects of natural-language rules that matched; on conflict
// "ask first" wins, as in Grok Bot's auto-review.
function combine(effects: Effect[]): Effect | null {
  if (!effects.length) return null;
  return new Set(effects).size > 1 ? 'ask' : effects[0];
}

// Nobody is watching a scheduled run, so "ask" fails closed.
function finalize(effect: Effect, rule: Rule | null, call: Call): Decision {
  if (effect === 'ask' && call.initiator === 'routine') {
    return { effect: 'deny', rule, reason: '루틴 실행 중에는 승인이 필요한 작업을 할 수 없습니다' };
  }
  return { effect, rule };
}

function maskSecrets(text: unknown, secretValues: string[]): string {
  let out = String(text ?? '');
  for (const value of secretValues) {
    if (value && value.length >= 4) out = out.split(value).join('••••');
  }
  return out;
}

export { accountWrite, decide, finalize, combine, maskSecrets, globToRegExp };
