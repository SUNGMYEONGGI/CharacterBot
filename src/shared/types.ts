// Shapes shared by the main process and the renderer: what state.json holds,
// what the main process broadcasts, and the preload bridge.
import type { Actions } from '../main/main';

export type Effect = 'allow' | 'ask' | 'deny';
export type Initiator = 'user' | 'bot' | 'routine';

export interface Memory {
  id: string;
  text: string;
  ts: number;
}

export interface Bot {
  id: string;
  name: string;
  label: string;
  color: string;
  shape: number;
  image?: string | null; // data URL of an AI profile icon (null clears it)
  systemPrompt: string;
  model: string; // '' = default; 'openai:<slug>' runs on Codex
  skillIds: string[];
  serverIds: string[];
  memories: Memory[];
  drafts?: boolean; // false: outside-app writes skip the approval card
}

export interface Attachment {
  name: string;
  dataUrl?: string;
  text?: string;
}

export interface QuestionCard {
  type: 'question';
  question: string;
  options: string[];
  answer?: string;
}
export interface MeetingCard {
  type: 'meeting';
  title: string;
  start?: string;
  end?: string;
  organizer?: string;
  [key: string]: unknown;
  answer?: string;
}
export interface SkillCard {
  type: 'skill';
  name: string;
  description: string;
  body: string;
  saved?: boolean;
}
export type Card = QuestionCard | MeetingCard | SkillCard;

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  ts: number;
  content: string;
  botId?: string;
  // user messages
  attachments?: Attachment[];
  skillId?: string | null;
  voice?: { dataUrl: string; duration: number };
  voiceChat?: boolean;
  routineId?: string;
  event?: string;
  fromBotId?: string;
  brief?: boolean; // a maker Bot's hidden note that made this Bot say hello
  // assistant messages
  toolCalls?: ToolCall[];
  error?: string;
  // tool entries
  toolCallId?: string;
  name?: string;
  args?: Record<string, unknown>;
  effect?: Effect;
  sent?: boolean;
  card?: Card;
  // every role
  threadOf?: string;
  viaBotId?: string;
  reactions?: string[];
}

export interface Session {
  id: string | null;
  cursor: number;
  engine?: 'claude' | 'codex';
}

export interface Task {
  text: string;
  status: 'todo' | 'doing' | 'done';
}

export interface Conv {
  id: string;
  kind: 'dm' | 'group';
  name: string;
  botIds: string[];
  messages: Message[];
  sessions: Record<string, Session>;
  updatedAt: number;
  summary?: { upto: number; text: string; ts: number } | null;
  sectionId?: string;
  pinned?: boolean;
  unread?: boolean;
  hidden?: boolean;
  tasks?: { goal: string; items: Task[] } | null; // track_tasks: the chat's goal and its checklist
}

export interface Section {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  source: string; // 'user' or a plugin id
  disabled?: boolean;
}

export interface OauthConfig {
  provider?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  [key: string]: unknown;
}

export interface McpServer {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  oauth?: OauthConfig;
  enabled: boolean;
  source: string;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  path: string;
  enabled: boolean;
}

export type Schedule =
  | { type: 'interval'; minutes: number }
  | { type: 'daily'; time: string }
  | { type: 'webhook'; key: string }
  | { type: 'file'; path: string }
  | { type: 'github'; repo: string };

export interface Routine {
  id: string;
  convId: string;
  botId: string;
  prompt: string;
  schedule: Schedule;
  enabled: boolean;
  createdAt: number;
  lastRun: number;
  failures: number;
  pending?: string[];
}

export interface Rule {
  id: string;
  effect: Effect;
  tool?: string;
  match?: string;
  botId?: string;
}

export interface ReviewRule {
  id: string;
  when: string;
  effect: Effect;
}

export interface AuditEntry {
  id: string;
  ts: number;
  botId: string;
  convId: string;
  tool: string;
  initiator: Initiator;
  args: unknown;
  effect: Effect;
  outcome: 'ok' | 'refused' | 'error';
  output: string;
}

export interface Provider {
  id: string;
  kind: 'claude' | 'anthropic' | 'custom';
  name: string;
  baseUrl?: string;
}

export interface Settings {
  userName: string;
  providers: Provider[];
  provider: string;
  model: string;
  chatgpt: boolean;
  imageModel: string;
  hardwareAcceleration: boolean;
  theme: 'system' | 'light' | 'dark';
  accent: string;
  spellcheck: boolean;
  notifications: boolean;
  timezone: string;
  autoReview: boolean;
  reviewRules: ReviewRule[];
  computerAccess: Effect;
  fullAccess: boolean;
  blockAccountWrites: boolean;
  micId: string; // '' = the system default microphone
  onboarded: boolean; // first-run setup (accounts, name, team) finished
  mainBotId?: string;
}

export interface Usage {
  turns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface State {
  settings: Settings;
  bots: Bot[];
  convs: Conv[];
  sections: Section[];
  skills: Skill[];
  mcpServers: McpServer[];
  plugins: Plugin[];
  routines: Routine[];
  rules: Rule[];
  audit: AuditEntry[];
  usage: Usage;
}

// ----- what the main process broadcasts -----

export interface Approval {
  id: string;
  convId: string;
  botId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ActiveRun {
  botId: string;
  phase: 'thinking' | 'working';
  queue: string[];
  delegates?: string[];
  threadOf?: string;
  viaBotId?: string;
  status?: { subject: string; verb: string }; // set_status: "학회 정보 검색 중"
}

export interface RunRecord {
  convId: string;
  botIds: string[];
  initiator: Initiator;
  start: number;
  end: number;
  ok: boolean;
  stopped: boolean;
}

export interface LoginStatus {
  loggedIn?: boolean;
  email?: string;
  plan?: string;
  checking?: boolean;
  error?: string;
}

export interface ModelInfo {
  value: string; // '' = default; 'openai:<slug>' for ChatGPT models
  name: string;
  description?: string;
  id?: string;
}

export interface McpStatus {
  status: string;
  error?: string;
  tools: string[];
}

export interface Broadcast extends State {
  routineInfo: Record<string, { when: string; url: string | null; error: string | null }>;
  runtime: {
    pending: Approval[];
    running: string[];
    active: Record<string, ActiveRun>;
    started: Record<string, number>;
    history: RunRecord[];
  };
  mcpStatus: Record<string, McpStatus>;
  secretNames: string[];
  legacySecrets: 'importing' | 'failed' | null; // CharacterBot 0.1.x secrets not yet imported
  oauthConnected: string[];
  hasGoogleClient: boolean;
  providerKeys: string[];
  claude: LoginStatus | null;
  chatgpt: LoginStatus | null;
  oauthRedirect: string;
  models: ModelInfo[];
}

export interface StreamChunk {
  convId: string;
  msgId: string;
  text: string;
}

// window.desktop, exposed by the preload script.
export interface DesktopApi {
  init(): Promise<boolean>;
  act<K extends keyof Actions>(name: K, ...args: Parameters<Actions[K]>): Promise<Awaited<ReturnType<Actions[K]>>>;
  onState(fn: (state: Broadcast) => void): void;
  onStream(fn: (chunk: StreamChunk) => void): void;
}

declare global {
  interface Window {
    desktop: DesktopApi;
    // Set by the renderer's app.ts for the other views (and for debugging).
    app: { select: (convId: string) => void; getState: () => Broadcast | null };
  }
}
