// App-specific tools exposed to the Claude agent through an in-process MCP
// server (`mcp__characterbot__*`). File, shell and web tools come from the SDK.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Bot, Routine, State } from '../shared/types';
import type { AgentSdk } from './agent';
import type { ScheduleInput } from './routines';

// Resolves a path inside the workspace and refuses anything that escapes it.
function inside(ws: string, p = '.'): string {
  const full = path.resolve(ws, p);
  if (full !== ws && !full.startsWith(ws + path.sep)) throw new Error('작업 폴더 밖의 경로는 사용할 수 없습니다');
  return full;
}

export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
}

function listFiles(ws: string, dir = '.'): FileEntry[] {
  const root = inside(ws, dir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !path.relative(ws, e.parentPath).split(path.sep).some((p) => p.startsWith('.')))
    .map((e) => {
      const full = path.join(e.parentPath, e.name);
      const stat = fs.statSync(full);
      return { path: path.relative(ws, full), size: stat.size, mtime: stat.mtimeMs };
    });
}

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string): Result => ({ content: [{ type: 'text', text: t }] });

export interface ToolCtx {
  bot: Bot;
  state: State;
  messageBot: (name: string, message: string) => Promise<string>;
  createRoutine: (args: ScheduleInput & { prompt: string }) => Routine;
  webhookUrl: (key: string) => string;
  cancelRoutine: (id: string) => void;
}

// One tool, independent of which MCP server carries it.
interface Spec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<Result>;
}
function spec<S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (args: z.infer<z.ZodObject<S>>) => Promise<string>): Spec {
  const handler = async (args: Record<string, unknown>) => {
    try {
      return text(await fn(args as z.infer<z.ZodObject<S>>));
    } catch (err) {
      return { ...text(`Error: ${(err as Error).message}`), isError: true };
    }
  };
  return { name, description, shape, handler };
}

function specs(ctx: ToolCtx): Spec[] {
  return [
    spec('ask_user', '사용자에게 선택지 질문 카드를 보여줍니다. 호출한 뒤에는 추가 작업 없이 바로 턴을 끝내고 답을 기다리세요.', {
      question: z.string(),
      options: z.array(z.string()).describe('2~5개의 선택지'),
    }, async () => '질문 카드를 보여줬습니다. 턴을 끝내고 사용자의 답을 기다리세요.'),
    spec('remember', '사용자에 대해 오래 기억할 사실을 메모리에 저장합니다.', { text: z.string() }, async ({ text: t }) => {
      const memory = { id: `mem_${Date.now().toString(36)}`, text: t, ts: Date.now() };
      ctx.bot.memories.push(memory);
      return `기억함 (${memory.id})`;
    }),
    spec('forget', '메모리 항목을 지웁니다.', { id: z.string() }, async ({ id }) => {
      ctx.bot.memories = ctx.bot.memories.filter((m) => m.id !== id);
      return '지웠습니다';
    }),
    spec('use_skill', '스킬의 전체 지침을 불러옵니다.', { name: z.string() }, async ({ name }) => {
      const skill = ctx.state.skills.find((s) => s.name === name && !s.disabled && ctx.bot.skillIds.includes(s.id));
      if (!skill) throw new Error(`이 Bot에 "${name}" 스킬이 없습니다`);
      return skill.body;
    }),
    spec('propose_skill', '새 스킬을 제안합니다. 사용자가 카드의 저장 버튼을 눌러야 저장됩니다.', {
      name: z.string(), description: z.string(), body: z.string().describe('스킬 지침(마크다운)'),
    }, async () => '스킬 제안 카드를 보여줬습니다.'),
    spec('schedule_routine', '이 대화에서 반복 실행할 루틴을 만듭니다. 시간: every_minutes(최소 15) 또는 daily_time(HH:MM). 이벤트: webhook(true면 로컬 웹훅 주소가 생김), watch_path(이 폴더의 파일이 바뀔 때), github_repo(owner/name 저장소의 PR이 열리거나 업데이트될 때) 중 하나를 주세요.', {
      prompt: z.string(), every_minutes: z.number().optional(), daily_time: z.string().optional(),
      webhook: z.boolean().optional(), watch_path: z.string().optional(), github_repo: z.string().optional(),
    }, async (args) => {
      const r = ctx.createRoutine(args);
      return `루틴을 만들었습니다 (${r.id})${r.schedule.type === 'webhook' ? `. 웹훅 주소: ${ctx.webhookUrl(r.schedule.key)} (이 컴퓨터에서만 POST로 호출 가능)` : ''}`;
    }),
    spec('message_bot', '다른 Bot에게 DM을 보내 일을 맡기거나 묻고, 그 Bot의 답을 받아옵니다.', {
      bot_name: z.string(), message: z.string(),
    }, async ({ bot_name: name, message }) => ctx.messageBot(name, message)),
    spec('request_meeting_approval', '사용자가 요청하지 않은 회의 초대를 발견하면 참석 여부를 묻는 회의 카드를 보여줍니다. 호출한 뒤에는 바로 턴을 끝내고 사용자의 결정을 기다리세요. 수락·거절하면 캘린더에 응답할 권한이 한 번 주어집니다.', {
      title: z.string(), start: z.string().describe('시작 시각 (예: 10월 24일 (금) 오후 3:00)'), end: z.string().optional(),
      organizer: z.string().optional(), location: z.string().optional(), event_id: z.string().optional(),
    }, async () => '회의 카드를 보여줬습니다. 턴을 끝내고 사용자의 결정을 기다리세요.'),
    spec('cancel_routine', '루틴을 끕니다.', { id: z.string() }, async ({ id }) => {
      ctx.cancelRoutine(id);
      return '루틴을 껐습니다';
    }),
  ];
}

// The in-process server for Claude turns.
function buildServer(agentSdk: AgentSdk, ctx: ToolCtx): McpSdkServerConfigWithInstance {
  return agentSdk.createSdkMcpServer({
    name: 'characterbot',
    tools: specs(ctx).map((s) => agentSdk.tool(s.name, s.description, s.shape, s.handler)),
  });
}

// The same tools for Codex (ChatGPT) turns, over a local streamable-HTTP MCP
// server. Each turn gets its own bearer token that maps to that turn's ctx.
const turns = new Map<string, ToolCtx>(); // token -> ctx
let endpoint: Promise<string> | null = null;

function httpEndpoint(): Promise<string> {
  endpoint ||= (async () => {
    const srv = http.createServer(async (req, res) => {
      const ctx = turns.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!ctx) return void res.writeHead(401).end();
      const server = new McpServer({ name: 'characterbot', version: '1.0.0' });
      for (const s of specs(ctx)) server.registerTool(s.name, { description: s.description, inputSchema: s.shape }, s.handler);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
  })();
  return endpoint;
}

export interface AppTools {
  url: string;
  token: string;
  close: () => void;
}

// Resolves { url, token, close() } for one Codex turn.
async function openHttpTurn(ctx: ToolCtx): Promise<AppTools> {
  const token = crypto.randomBytes(24).toString('hex');
  turns.set(token, ctx);
  return { url: await httpEndpoint(), token, close: () => turns.delete(token) };
}

export { buildServer, openHttpTurn, listFiles, inside };
