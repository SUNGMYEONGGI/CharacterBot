// App-specific tools exposed to the Claude agent through an in-process MCP
// server (`mcp__grokbot__*`). File, shell and web tools come from the SDK.
const fs = require('node:fs');
const path = require('node:path');

// Resolves a path inside the workspace and refuses anything that escapes it.
function inside(ws, p = '.') {
  const full = path.resolve(ws, p);
  if (full !== ws && !full.startsWith(ws + path.sep)) throw new Error('작업 폴더 밖의 경로는 사용할 수 없습니다');
  return full;
}

function listFiles(ws, dir = '.') {
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

const text = (t) => ({ content: [{ type: 'text', text: t }] });

// ctx: { bot, state, createRoutine(args), cancelRoutine(id), messageBot(name, text) }
function buildServer({ tool, createSdkMcpServer }, z, ctx) {
  const guard = (fn) => async (args) => {
    try {
      return text(await fn(args));
    } catch (err) {
      return { ...text(`Error: ${err.message}`), isError: true };
    }
  };
  return createSdkMcpServer({
    name: 'grokbot',
    tools: [
      tool('ask_user', '사용자에게 선택지 질문 카드를 보여줍니다. 호출한 뒤에는 추가 작업 없이 바로 턴을 끝내고 답을 기다리세요.', {
        question: z.string(),
        options: z.array(z.string()).describe('2~5개의 선택지'),
      }, guard(async () => '질문 카드를 보여줬습니다. 턴을 끝내고 사용자의 답을 기다리세요.')),
      tool('remember', '사용자에 대해 오래 기억할 사실을 메모리에 저장합니다.', { text: z.string() }, guard(async ({ text: t }) => {
        const memory = { id: `mem_${Date.now().toString(36)}`, text: t, ts: Date.now() };
        ctx.bot.memories.push(memory);
        return `기억함 (${memory.id})`;
      })),
      tool('forget', '메모리 항목을 지웁니다.', { id: z.string() }, guard(async ({ id }) => {
        ctx.bot.memories = ctx.bot.memories.filter((m) => m.id !== id);
        return '지웠습니다';
      })),
      tool('use_skill', '스킬의 전체 지침을 불러옵니다.', { name: z.string() }, guard(async ({ name }) => {
        const skill = ctx.state.skills.find((s) => s.name === name && !s.disabled && ctx.bot.skillIds.includes(s.id));
        if (!skill) throw new Error(`이 Bot에 "${name}" 스킬이 없습니다`);
        return skill.body;
      })),
      tool('propose_skill', '새 스킬을 제안합니다. 사용자가 카드의 저장 버튼을 눌러야 저장됩니다.', {
        name: z.string(), description: z.string(), body: z.string().describe('스킬 지침(마크다운)'),
      }, guard(async () => '스킬 제안 카드를 보여줬습니다.')),
      tool('schedule_routine', '이 대화에서 반복 실행할 루틴을 만듭니다. 시간: every_minutes(최소 15) 또는 daily_time(HH:MM). 이벤트: webhook(true면 로컬 웹훅 주소가 생김), watch_path(이 폴더의 파일이 바뀔 때), github_repo(owner/name 저장소의 PR이 열리거나 업데이트될 때) 중 하나를 주세요.', {
        prompt: z.string(), every_minutes: z.number().optional(), daily_time: z.string().optional(),
        webhook: z.boolean().optional(), watch_path: z.string().optional(), github_repo: z.string().optional(),
      }, guard(async (args) => {
        const r = ctx.createRoutine(args);
        return `루틴을 만들었습니다 (${r.id})${r.schedule.type === 'webhook' ? `. 웹훅 주소: ${ctx.webhookUrl(r.schedule.key)} (이 컴퓨터에서만 POST로 호출 가능)` : ''}`;
      })),
      tool('message_bot', '다른 Bot에게 DM을 보내 일을 맡기거나 묻고, 그 Bot의 답을 받아옵니다.', {
        bot_name: z.string(), message: z.string(),
      }, guard(async ({ bot_name: name, message }) => ctx.messageBot(name, message))),
      tool('request_meeting_approval', '사용자가 요청하지 않은 회의 초대를 발견하면 참석 여부를 묻는 회의 카드를 보여줍니다. 호출한 뒤에는 바로 턴을 끝내고 사용자의 결정을 기다리세요. 수락·거절하면 캘린더에 응답할 권한이 한 번 주어집니다.', {
        title: z.string(), start: z.string().describe('시작 시각 (예: 10월 24일 (금) 오후 3:00)'), end: z.string().optional(),
        organizer: z.string().optional(), location: z.string().optional(), event_id: z.string().optional(),
      }, guard(async () => '회의 카드를 보여줬습니다. 턴을 끝내고 사용자의 결정을 기다리세요.')),
      tool('cancel_routine', '루틴을 끕니다.', { id: z.string() }, guard(async ({ id }) => {
        ctx.cancelRoutine(id);
        return '루틴을 껐습니다';
      })),
    ],
  });
}

// The same tools for Codex (ChatGPT) turns, over a local streamable-HTTP MCP
// server. Each turn gets its own bearer token that maps to that turn's ctx.
const turns = new Map(); // token -> ctx
let endpoint = null;

function httpEndpoint() {
  endpoint ||= (async () => {
    const http = require('node:http');
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
    const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const { z } = await import('zod');
    const collect = { tool: (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler }), createSdkMcpServer: ({ tools }) => tools };
    const srv = http.createServer(async (req, res) => {
      const ctx = turns.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!ctx) return res.writeHead(401).end();
      const server = new McpServer({ name: 'grokbot', version: '1.0.0' });
      for (const t of buildServer(collect, z, ctx)) server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, t.handler);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${srv.address().port}/mcp`;
  })();
  return endpoint;
}

// Resolves { url, token, close() } for one Codex turn.
async function openHttpTurn(ctx) {
  const token = require('node:crypto').randomBytes(24).toString('hex');
  turns.set(token, ctx);
  return { url: await httpEndpoint(), token, close: () => turns.delete(token) };
}

module.exports = { buildServer, openHttpTurn, listFiles, inside };
