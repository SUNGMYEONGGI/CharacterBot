import fs from 'node:fs';
import type { Bot, Conv, State } from '../shared/types';

const COLORS = ['#f7931a', '#ef3b4b', '#20b15a', '#f26a1b', '#2f7cf6', '#8b5cf6', '#111111'];
const id = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function newBot(name: string, index: number): Bot {
  return {
    id: id('bot'),
    name,
    label: '',
    color: COLORS[index % COLORS.length],
    shape: index % 14,
    systemPrompt: `You are ${name}, a helpful agent. Answer in the user's language.`,
    model: '',
    skillIds: [],
    serverIds: [],
    memories: [],
  };
}

function newConv(kind: Conv['kind'], botIds: string[], name = ''): Conv {
  return { id: id('conv'), kind, name, botIds, messages: [], sessions: {}, updatedAt: Date.now() };
}

function defaultState(): State {
  const bot = newBot('Octo', 0);
  return {
    settings: {
      userName: '나',
      providers: [{ id: 'claude', kind: 'claude', name: 'Claude' }],
      provider: 'claude',
      model: '',
      chatgpt: false, // ChatGPT subscription added (image generation)
      imageModel: 'auto',
      hardwareAcceleration: true,
      theme: 'system',
      accent: 'bot',
      spellcheck: true,
      notifications: true,
      timezone: 'auto',
      autoReview: true,
      reviewRules: [],
      computerAccess: 'allow',
      fullAccess: true,
      blockAccountWrites: true,
      onboarded: false,
    },
    bots: [bot],
    sections: [],
    convs: [newConv('dm', [bot.id])],
    skills: [],
    mcpServers: [],
    plugins: [],
    routines: [],
    rules: [],
    audit: [],
    usage: { turns: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 },
  };
}

// Fills in fields added after a state file was written, and converts the
// first version's `{ agents: [...] }` layout.
// The file is untyped JSON from any past version.
function migrate(raw: any): State {
  const defaults = defaultState();
  const state = { ...defaults, ...raw, settings: { ...defaults.settings, ...raw.settings }, usage: { ...defaults.usage, ...raw.usage } };
  delete state.settings.baseUrl;
  delete state.settings.auth;
  // Installs from before first-run setup existed are already set up.
  if (raw.settings && raw.settings.onboarded === undefined) state.settings.onboarded = true;
  // Full permissions became the default; move older installs over once.
  if (!raw.settings?.fullAccess && raw.settings) Object.assign(state.settings, { computerAccess: 'allow', fullAccess: true });
  if (raw.agents && !raw.bots) {
    state.bots = raw.agents.map(({ messages: _, ...a }: any) => ({ ...newBot(a.name, 0), ...a }));
    state.convs = raw.agents.map((a: any) => ({ ...newConv('dm', [a.id]), messages: a.messages.map((m: any) => ({ id: id('msg'), ts: Date.now(), ...m, botId: m.role === 'assistant' ? a.id : undefined })) }));
    delete state.agents;
  }
  return state;
}

function load(file: string): State {
  try {
    return migrate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return defaultState();
  }
}

function save(file: string, state: State): void {
  // Write to a temp file first so a crash mid-write can't corrupt history.
  // Owner-only: it holds every conversation and what the Bots read.
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
  fs.chmodSync(`${file}.tmp`, 0o600);
  fs.renameSync(`${file}.tmp`, file);
}

export { id, newBot, newConv, defaultState, load, save, COLORS };
