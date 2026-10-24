// "앱 연결": a catalog of MCP servers and skills, plus custom MCP and plugins.
import type { Broadcast, McpServer, McpStatus, Skill } from '../shared/types';
import { h, fill, $, act, icon, openModal, closeModal, toast, popover, type Child } from './ui';
import { LOGOS } from './logos';

interface CatalogItem {
  name: string;
  title: string;
  desc: string;
  cat: string;
  color?: string;
  logo?: string;
  rec?: boolean;
  secret?: string;
  cfg: Partial<McpServer>;
}
type Tile = { name?: string; title?: string; color?: string; logo?: string };
type Page = () => [Child, Child];

// cfg.url: remote server; it signs in through the browser (OAuth) only if it asks to.
// secret: a token the user pastes. cfg.command: runs locally with no account.
const CATALOG: CatalogItem[] = [
  { name: 'gmail', title: 'Gmail', desc: 'Search, read and draft emails in your Gmail inbox.', cat: '커뮤니케이션', rec: true, cfg: { url: 'https://gmailmcp.googleapis.com/mcp/v1' } },
  { name: 'google-calendar', title: 'Google Calendar', desc: 'See your schedule, events and free time.', cat: '생산성', rec: true, cfg: { url: 'https://calendarmcp.googleapis.com/mcp/v1' } },
  { name: 'google-drive', title: 'Google Drive', desc: 'Find and read files in your Drive.', cat: '생산성', cfg: { url: 'https://drivemcp.googleapis.com/mcp/v1' } },
  { name: 'google-docs', title: 'Google Docs', desc: 'Read and write Google Docs.', cat: '생산성', cfg: { url: 'https://docsmcp.googleapis.com/mcp/v1' } },
  { name: 'google-sheets', title: 'Google Sheets', desc: 'Read and update spreadsheets.', cat: '생산성', cfg: { url: 'https://sheetsmcp.googleapis.com/mcp/v1' } },
  { name: 'google-slides', title: 'Google Slides', desc: 'Read and build presentations.', cat: '생산성', cfg: { url: 'https://slidesmcp.googleapis.com/mcp/v1' } },
  { name: 'google-chat', title: 'Google Chat', desc: 'Read spaces and send messages in Google Chat.', cat: '커뮤니케이션', cfg: { url: 'https://chatmcp.googleapis.com/mcp/v1' } },
  { name: 'granola', title: 'Granola', desc: 'Your meetings in your workflow. Notes and transcripts.', cat: '생산성', color: '#5b8c3a', rec: true, cfg: { url: 'https://mcp.granola.ai/mcp' } },
  { name: 'postman', title: 'Postman', desc: 'Work with Postman from your agent: collections, APIs, environments.', cat: '코드', rec: true, cfg: { url: 'https://mcp.postman.com/mcp' } },
  { name: 'agentmail', title: 'AgentMail', desc: 'Email inboxes for agents. Create, send and receive.', cat: '커뮤니케이션', color: '#111', rec: true, cfg: { url: 'https://mcp.agentmail.to/mcp' } },
  { name: 'apify', title: 'Apify', desc: 'Official Apify actors for scraping and automation.', cat: '웹·리서치', color: '#246dff', rec: true, cfg: { url: 'https://mcp.apify.com' } },
  { name: 'grafana', title: 'Grafana Labs', desc: 'Dashboards, alerts and observability data.', cat: '데이터·분석', rec: true, cfg: { url: 'https://mcp.grafana.com/mcp' } },
  { name: 'posthog', title: 'PostHog', desc: 'Access PostHog analytics, feature flags and experiments.', cat: '데이터·분석', rec: true, cfg: { url: 'https://mcp.posthog.com/mcp' } },
  { name: 'notion', title: 'Notion', desc: 'Search Notion pages and databases, create and edit content.', cat: '생산성', cfg: { url: 'https://mcp.notion.com/mcp' } },
  { name: 'atlassian', title: 'Atlassian', desc: 'Jira issues and Confluence pages.', cat: '생산성', cfg: { url: 'https://mcp.atlassian.com/v1/mcp' } },
  { name: 'linear', title: 'Linear', desc: 'Issues, projects and cycles in Linear.', cat: '생산성', cfg: { url: 'https://mcp.linear.app/mcp' } },
  { name: 'airtable', title: 'Airtable', desc: 'Read and update bases, tables and records.', cat: '생산성', cfg: { url: 'https://mcp.airtable.com/mcp' } },
  { name: 'dropbox', title: 'Dropbox', desc: 'Find, read and organize Dropbox files.', cat: '생산성', cfg: { url: 'https://mcp.dropbox.com/mcp' } },
  { name: 'clickup', title: 'ClickUp', desc: 'Tasks, docs and goals in ClickUp.', cat: '생산성', cfg: { url: 'https://mcp.clickup.com/mcp' } },
  { name: 'monday', title: 'monday.com', desc: 'Boards, items and updates on monday.com.', cat: '생산성', color: '#ff3d57', cfg: { url: 'https://mcp.monday.com/mcp' } },
  { name: 'calendly', title: 'Calendly', desc: 'Scheduling links, events and invitees.', cat: '생산성', cfg: { url: 'https://mcp.calendly.com/mcp' } },
  { name: 'zapier', title: 'Zapier', desc: 'Run actions across thousands of apps with Zapier.', cat: '생산성', cfg: { url: 'https://mcp.zapier.com/api/mcp/mcp' } },
  { name: 'slack', title: 'Slack', desc: 'Read channels and threads, search and post messages.', cat: '커뮤니케이션', color: '#4a154b', secret: 'SLACK_MCP_XOXP_TOKEN', cfg: { command: 'npx', args: ['-y', 'slack-mcp-server@1.3.0', '--transport', 'stdio'], env: { SLACK_MCP_XOXP_TOKEN: '${SLACK_MCP_XOXP_TOKEN}' } } },
  { name: 'intercom', title: 'Intercom', desc: 'Conversations, contacts and help center.', cat: '커뮤니케이션', cfg: { url: 'https://mcp.intercom.com/mcp' } },
  { name: 'figma', title: 'Figma', desc: 'Turn designs into code with layout and style data.', cat: '디자인', cfg: { url: 'https://mcp.figma.com/mcp' } },
  { name: 'canva', title: 'Canva', desc: 'Create and edit Canva designs.', cat: '디자인', color: '#00c4cc', cfg: { url: 'https://mcp.canva.com/mcp' } },
  { name: 'miro', title: 'Miro', desc: 'Read and draw on Miro boards.', cat: '디자인', cfg: { url: 'https://mcp.miro.com/' } },
  { name: 'webflow', title: 'Webflow', desc: 'Sites, pages and CMS collections.', cat: '디자인', cfg: { url: 'https://mcp.webflow.com/mcp' } },
  { name: 'wix', title: 'Wix', desc: 'Build and manage Wix sites.', cat: '디자인', cfg: { url: 'https://mcp.wix.com/mcp' } },
  { name: 'github', title: 'GitHub', desc: 'Repositories, issues and pull requests.', cat: '코드', secret: 'GITHUB_TOKEN', cfg: { url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' } } },
  { name: 'gitlab', title: 'GitLab', desc: 'Projects, merge requests and pipelines on gitlab.com.', cat: '코드', cfg: { url: 'https://gitlab.com/api/v4/mcp' } },
  { name: 'sentry', title: 'Sentry', desc: 'Issues, errors and performance data from Sentry.', cat: '코드', cfg: { url: 'https://mcp.sentry.dev/mcp' } },
  { name: 'vercel', title: 'Vercel', desc: 'Deployments, projects and logs on Vercel.', cat: '코드', cfg: { url: 'https://mcp.vercel.com' } },
  { name: 'netlify', title: 'Netlify', desc: 'Create, deploy and manage Netlify sites.', cat: '코드', cfg: { url: 'https://netlify-mcp.netlify.app/mcp' } },
  { name: 'supabase', title: 'Supabase', desc: 'Manage projects, tables and SQL in Supabase.', cat: '코드', cfg: { url: 'https://mcp.supabase.com/mcp' } },
  { name: 'neon', title: 'Neon', desc: 'Serverless Postgres projects and branches.', cat: '코드', cfg: { url: 'https://mcp.neon.tech/mcp' } },
  { name: 'cloudflare', title: 'Cloudflare', desc: 'Workers, DNS and account resources.', cat: '코드', cfg: { url: 'https://mcp.cloudflare.com/mcp' } },
  { name: 'huggingface', title: 'Hugging Face', desc: 'Models, datasets, Spaces and papers.', cat: '코드', cfg: { url: 'https://huggingface.co/mcp' } },
  { name: 'context7', title: 'Context7', desc: 'Up-to-date library and framework documentation.', cat: '코드', color: '#0f9d58', cfg: { url: 'https://mcp.context7.com/mcp' } },
  { name: 'jam', title: 'Jam', desc: 'Bug reports with console logs and network requests.', cat: '코드', color: '#e14e2b', cfg: { url: 'https://mcp.jam.dev/mcp' } },
  { name: 'amplitude', title: 'Amplitude', desc: 'Product analytics charts and cohorts.', cat: '데이터·분석', color: '#1e61f0', cfg: { url: 'https://mcp.amplitude.com/mcp' } },
  { name: 'attio', title: 'Attio', desc: 'CRM records, lists and notes in Attio.', cat: '영업·지원', color: '#111', cfg: { url: 'https://mcp.attio.com/mcp' } },
  { name: 'stripe', title: 'Stripe', desc: 'Customers, payments and products in Stripe.', cat: '결제·커머스', cfg: { url: 'https://mcp.stripe.com' } },
  { name: 'paypal', title: 'PayPal', desc: 'Invoices, orders and transactions.', cat: '결제·커머스', cfg: { url: 'https://mcp.paypal.com/mcp' } },
  { name: 'square', title: 'Square', desc: 'Payments, catalog and customers on Square.', cat: '결제·커머스', cfg: { url: 'https://mcp.squareup.com/mcp' } },
  { name: 'browser', title: 'Browser', desc: 'Bot이 실제 브라우저를 열어 클릭·입력·스크린샷을 합니다.', cat: '웹·리서치', cfg: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83'] } },
  { name: 'exa', title: 'Exa', desc: 'Neural web search and content retrieval.', cat: '웹·리서치', color: '#1f40ed', cfg: { url: 'https://mcp.exa.ai/mcp' } },
  { name: 'firecrawl', title: 'Firecrawl', desc: 'Scrape and crawl websites into clean markdown.', cat: '웹·리서치', color: '#ff4c00', secret: 'FIRECRAWL_API_KEY', cfg: { command: 'npx', args: ['-y', 'firecrawl-mcp@3.28.2'], env: { FIRECRAWL_API_KEY: '${FIRECRAWL_API_KEY}' } } },
  { name: 'brave', title: 'Brave Search', desc: 'Private web, news and image search.', cat: '웹·리서치', secret: 'BRAVE_API_KEY', cfg: { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server@2.1.4'], env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' } } },
  { name: 'filesystem', title: 'Files', color: '#4a90e2', desc: '내 데스크탑 폴더의 파일을 읽고 씁니다.', cat: '생산성', cfg: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2026.8.31', '${HOME}/Desktop'] } },
  { name: 'memory', title: 'Knowledge Graph', desc: '대화를 넘어 유지되는 지식 그래프 메모리.', cat: '생산성', color: '#7c5cff', cfg: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory@2026.8.31'] } },
];
const MAIN_CATS = ['생산성', '커뮤니케이션', '디자인', '코드'];
const MORE_CATS = ['데이터·분석', '영업·지원', '결제·커머스', '웹·리서치', '스킬', '사용자 지정'];

let S: Broadcast;
let view: 'catalog' | 'connected' | Page | null = null; // null while closed; 'catalog' | 'connected' | a function returning [head, body]
let cat = '전체';
let query = '';

const catalogOf = (server: McpServer) => CATALOG.find((c) => c.name === server.name);

// The service's own icon on a white tile, or the first letter on a color.
export function appTile(item: Tile | null | undefined, size = 50): HTMLElement {
  const src = LOGOS[item?.logo || item?.name || ''];
  const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.26)}px`;
  const glyph = Math.round(size * 0.62);
  if (src) return h('div', { class: 'tile logo', style }, h('img', { src, width: glyph, height: glyph, alt: '' }));
  const title = item?.title || item?.name || '?';
  return h('div', { class: 'tile', style: `${style};background:${item?.color || '#8b8b8b'};font-size:${Math.round(size * 0.42)}px` }, title[0].toUpperCase());
}
export const serverTile = (server: McpServer, size?: number): HTMLElement => appTile(catalogOf(server) || { name: server.name }, size);

export function openApps(which: 'catalog' | 'connected' = 'catalog'): void {
  view = which;
  cat = '전체';
  query = '';
  openModal(h('div', { class: 'modal apps' }), () => { view = null; });
  draw();
}

export function renderApps(state: Broadcast): void {
  S = state;
  if (view && $('#overlay .apps') && !$('#overlay .apps').contains(document.activeElement)) draw();
}

const statusOf = (server: McpServer) => S.mcpStatus[server.id]?.status;
const needsLogin = (server: McpServer) => statusOf(server) === 'auth';

// Grok Bot's flow: add, try without a token, open the browser only if the app asks.
async function connect(serverId: string, item?: CatalogItem) {
  toast('연결하는 중…');
  const res = await act('connectApp', serverId);
  if (res?.needsClient === 'google') { toast('Google 클라이언트를 한 번만 등록해 주세요'); return subPage(() => googlePage(item || {})); }
  if (res?.connected) toast('연결했어요');
}

async function addCatalog(item: CatalogItem): Promise<void> {
  const { secret } = item;
  if (secret && !S.secretNames.includes(secret)) return subPage(() => secretPage({ ...item, secret }));
  const existing = S.mcpServers.find((s) => s.name === item.name);
  const id = existing?.id || await act('addMcpServer', { name: item.name, ...item.cfg });
  if (id) connect(id, item);
}

function subPage(render: Page) {
  view = render;
  draw();
}
const back = () => { view = 'catalog'; draw(); };
const backBtn = () => h('button', { class: 'circle-btn', onclick: back }, h('span', { style: 'transform:rotate(180deg);display:inline-grid' }, icon('chevron', 16)));
const pageHead = (item: Tile, title: string) => h('div', { class: 'apps-title' }, h('div', { class: 'row' }, backBtn(), appTile(item, 32), h('h2', {}, title)));

function secretPage(item: CatalogItem & { secret: string }): [Child, Child] {
  const input = h('input', { class: 'field', type: 'password', placeholder: item.secret });
  setTimeout(() => input.focus());
  return [pageHead(item, `${item.title} 연결`), [
    h('p', { class: 'muted small' }, `${item.secret} 값을 입력하세요. 키체인에 암호화되어 저장되고 대화와 기록에는 가려져요.`),
    input,
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: async () => {
        if (!input.value) return;
        await act('setSecret', item.secret, input.value);
        await act('addMcpServer', { name: item.name, ...item.cfg });
        back();
      } }, '연결'),
      h('button', { class: 'btn', onclick: back }, '취소')),
  ]];
}

// Google's MCP servers only accept pre-registered OAuth clients. Grok Bot ships
// its own; here the user brings one, once, and every Google app reuses it.
function googlePage(item: Partial<CatalogItem>): [Child, Child] {
  const id = h('input', { class: 'field', placeholder: '클라이언트 ID (….apps.googleusercontent.com)' });
  const secret = h('input', { class: 'field', type: 'password', placeholder: '클라이언트 보안 비밀번호' });
  const copy = (text: string) => h('button', { class: 'copy', title: '복사', onclick: () => { navigator.clipboard.writeText(text); toast('복사했어요'); } }, h('code', {}, text));
  const done = async (ok: boolean | undefined) => {
    if (!ok) return;
    back();
    if (item.name) addCatalog(item as CatalogItem);
  };
  return [pageHead(item, 'Google 계정 연결'), [
    h('p', { class: 'muted small' }, 'Google 앱은 미리 등록된 OAuth 클라이언트로만 로그인할 수 있어요. 한 번만 등록하면 Gmail, 캘린더, 드라이브 등 모든 Google 앱이 "추가" 한 번으로 연결돼요.'),
    h('ol', { class: 'steps' },
      h('li', {}, h('a', { href: 'https://console.cloud.google.com/apis/credentials', target: '_blank' }, 'Google Cloud 콘솔'), '에서 ', h('b', {}, '웹 애플리케이션'), ' OAuth 클라이언트를 만들고 "AI 에이전트에 사용"을 켠 뒤, 리디렉션 URI에 ', copy(S.oauthRedirect), ' 를 넣으세요.'),
      h('li', {}, h('a', { href: 'https://console.cloud.google.com/apis/library', target: '_blank' }, 'API 라이브러리'), '에서 Gmail API와 Gmail MCP 등 쓸 앱의 API를 사용 설정하세요.'),
      h('li', {}, '내려받은 JSON 파일을 불러오면 끝이에요.')),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: async () => done(await act('importGoogleClient')) }, icon('download', 15), ' JSON 파일 불러오기')),
    h('details', { class: 'manual' }, h('summary', { class: 'muted small' }, '직접 입력'),
      h('div', { class: 'stack', style: 'margin-top:8px' }, id, secret,
        h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: async () => done(await act('setGoogleClient', id.value, secret.value)) }, '저장하고 연결')))),
  ]];
}

function appItem({ tile, title, desc, added = false, onAdd, addLabel = '추가' }: { tile: Node; title: string; desc: string; added?: boolean; onAdd?: () => void; addLabel?: string }) {
  return h('div', { class: 'app-item' },
    tile,
    h('div', { class: 'meta' }, h('div', { class: 'title ellipsis' }, title), h('div', { class: 'desc ellipsis' }, desc)),
    added ? h('span', { class: 'added' }, icon('check', 14), '추가됨') : h('button', { class: 'add-btn', onclick: onAdd }, addLabel));
}

function catalogItems(list: CatalogItem[]) {
  return h('div', { class: 'app-grid' }, list.map((item) => {
    const server = S.mcpServers.find((s) => s.name === item.name);
    return appItem({
      tile: appTile(item), title: item.title, desc: item.desc,
      added: Boolean(server && !needsLogin(server)),
      addLabel: server ? '로그인' : '추가',
      onAdd: () => addCatalog(item),
    });
  }));
}

const iconTile = (name: string) => h('div', { class: 'tile logo', style: 'width:50px;height:50px;border-radius:13px' }, icon(name, 24));

function skillItems(list: Skill[]) {
  return h('div', { class: 'app-grid' }, list.map((s) => appItem({ tile: iconTile('sparkle'), title: s.name, desc: s.description || '스킬', added: true })));
}

function drawCatalog(head: Element, body: Element) {
  const search = h('input', { placeholder: '앱 및 스킬 전체 검색', value: query, oninput: (e) => { query = e.target.value; drawCatalogBody(body); } });
  const enabled = S.mcpServers.filter((s) => s.enabled);
  const more: HTMLElement = h('button', { class: `cat${MORE_CATS.includes(cat) ? ' active' : ''}`, onclick: () => popover(more, MORE_CATS.map((c) => ({ label: c, onclick: () => { cat = c; draw(); } }))) },
    MORE_CATS.includes(cat) ? cat : '더보기', icon('down', 14));
  fill(head,
    h('div', { class: 'apps-title' },
      h('h2', {}, '앱 연결'),
      h('button', { class: 'connected-link', onclick: () => { view = 'connected'; draw(); } },
        h('span', { class: 'mini-tiles' }, enabled.slice(0, 4).map((s) => serverTile(s, 20))),
        `${enabled.length}개 연결됨`, icon('chevron', 14))),
    h('div', { class: 'search-row' },
      h('label', { class: 'search-box' }, icon('search', 16), search),
      h('button', { class: 'outline-btn', onclick: async () => { const id = await act('importBot'); if (id) { closeModal(); window.app.select(id); } } },
        h('span', { class: 'tpl-dot' }), 'Bot 템플릿', icon('external', 14))),
    h('div', { class: 'cats' }, ['전체', ...MAIN_CATS].map((c) => h('button', { class: `cat${cat === c ? ' active' : ''}`, onclick: () => { cat = c; draw(); } }, c)), more),
  );
  drawCatalogBody(body);
}

function drawCatalogBody(body: Element): void {
  const q = query.trim().toLowerCase();
  const match = (...fields: (string | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q));
  const apps = CATALOG.filter((c) => match(c.title, c.desc, c.name));
  const skills = S.skills.filter((s) => !s.disabled && match(s.name, s.description));
  const section = (title: string, content: Child, more?: string): Child[] => [h('h3', {}, title, more ? h('button', { onclick: () => { cat = more; draw(); } }, '모두 보기') : null), content];

  if (cat === '사용자 지정') return fill(body, ...customView());
  if (cat === '스킬') return fill(body, ...section('스킬', skills.length ? skillItems(skills) : h('p', { class: 'muted small' }, '설정 › 스킬에서 스킬을 만들거나 플러그인으로 설치하세요.')));
  if (cat === '맞춤 추천') return fill(body, ...section(cat, catalogItems(apps.filter((a) => a.rec))));
  if (cat !== '전체') return fill(body, ...section(cat, catalogItems(apps.filter((a) => a.cat === cat))));
  if (q) return fill(body, ...section('앱', catalogItems(apps)), ...(skills.length ? section('스킬', skillItems(skills)) : []));
  fill(body,
    ...section('맞춤 추천', catalogItems(apps.filter((a) => a.rec).slice(0, 6)), '맞춤 추천'),
    ...[...MAIN_CATS, ...MORE_CATS.slice(0, 4)].flatMap((c) => section(c, catalogItems(apps.filter((a) => a.cat === c).slice(0, 4)), c)),
    ...section('사용자 지정', h('div', { class: 'app-grid' },
      appItem({ tile: iconTile('tool'), title: 'MCP 서버', desc: 'JSON 설정으로 MCP 서버를 직접 추가해요.', onAdd: () => { cat = '사용자 지정'; draw(); } }),
      appItem({ tile: iconTile('folder'), title: '플러그인', desc: '폴더에서 Claude Code/Cursor 플러그인을 설치해요.', onAdd: () => act('installPlugin'), addLabel: '설치' }))),
  );
}

function customView() {
  const json = h('textarea', { class: 'field', style: 'min-height:200px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px', placeholder: '{\n  "mcpServers": {\n    "이름": { "command": "npx", "args": ["-y", "패키지"], "env": { "TOKEN": "${MY_SECRET}" } },\n    "원격": { "url": "https://…/mcp", "headers": { "Authorization": "Bearer ${MY_SECRET}" } }\n  }\n}' });
  return [
    h('h3', {}, 'MCP 서버 JSON'),
    h('p', { class: 'muted small' }, 'Claude Desktop/Claude Code 형식 그대로 붙여넣으세요. 토큰은 설정 › 시크릿에 넣고 ${이름}으로 참조하세요. 원격 서버가 로그인을 요구하면 브라우저 로그인 창이 자동으로 열려요.'),
    json,
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: async () => { if (json.value.trim() && (await act('addMcpJson', json.value)) !== undefined) { toast('추가했어요'); view = 'connected'; draw(); } } }, '추가')),
    h('h3', {}, '플러그인'),
    h('p', { class: 'muted small' }, 'MCP 서버와 스킬 묶음이에요. plugin.json 또는 .claude-plugin/plugin.json, .mcp.json, skills/*/SKILL.md 구조를 지원해요.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => act('installPlugin') }, '폴더에서 설치')),
  ];
}

function statusText(st: McpStatus): string {
  if (st.status === 'auth') return '로그인이 필요해요';
  if (st.status === 'error') return `오류: ${st.error}`;
  if (st.status === 'connected') return `도구 ${st.tools.length}개 · ${st.tools.slice(0, 6).join(', ')}`;
  return st.status === 'off' ? '꺼짐' : '연결 확인 중…';
}

function drawConnected(head: Element, body: Element) {
  fill(head, h('div', { class: 'apps-title' }, h('div', { class: 'row' }, backBtn(), h('h2', {}, '연결된 앱'))));
  fill(body,
    h('div', { class: 'list' }, S.mcpServers.length ? S.mcpServers.map((s) => {
      const st: McpStatus = S.mcpStatus[s.id] || { status: s.enabled ? 'connecting' : 'off', tools: [] };
      const plugin = S.plugins.find((p) => p.id === s.source);
      return h('div', {},
        h('div', { class: 'row' }, serverTile(s, 36),
          h('div', { class: 'grow' },
            h('div', { class: 'row' }, h('b', { class: 'ellipsis' }, catalogOf(s)?.title || s.name), h('span', { class: `status ${st.status}` }), plugin ? h('span', { class: 'badge' }, plugin.name) : null),
            h('div', { class: 'muted small ellipsis' }, statusText(st))),
          needsLogin(s) ? h('button', { class: 'add-btn', onclick: () => connect(s.id, catalogOf(s)) }, '로그인')
            : S.oauthConnected.includes(s.id) ? h('button', { class: 'add-btn', onclick: () => act('disconnectMcp', s.id) }, '로그아웃') : null,
          h('input', { type: 'checkbox', class: 'toggle', checked: s.enabled, onchange: (e) => act('updateMcpServer', s.id, { enabled: e.target.checked }) }),
          plugin ? null : h('button', { class: 'x', title: '삭제', onclick: () => act('deleteMcpServer', s.id) }, '×')));
    }) : h('div', { class: 'empty-row' }, '아직 연결된 앱이 없어요')),
    S.plugins.length ? [h('h3', {}, '플러그인'), h('div', { class: 'list' }, S.plugins.map((p) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted small' }, p.description || p.path)),
      h('input', { type: 'checkbox', class: 'toggle', checked: p.enabled, onchange: (e) => act('setPluginEnabled', p.id, e.target.checked) }),
      h('button', { class: 'x', onclick: () => act('removePlugin', p.id) }, '×'))))] : null,
  );
}

const frame = () => [h('button', { class: 'close', onclick: closeModal }, icon('close', 20)), h('div', { class: 'apps-head' }), h('div', { class: 'apps-body' })];

function draw() {
  const root = document.querySelector<HTMLElement>('#overlay .apps');
  if (!root) return;
  if (!root.querySelector('.apps-body')) fill(root, ...frame());
  const head = $('#overlay .apps-head');
  const body = $('#overlay .apps-body');
  if (typeof view === 'function') {
    // Sub-pages hold typed input; only draw them once.
    if (root.dataset.page === String(view)) return;
    root.dataset.page = String(view);
    const [title, content] = view();
    fill(head, title);
    fill(body, content);
    return;
  }
  delete root.dataset.page;
  if (view === 'connected') drawConnected(head, body);
  else drawCatalog(head, body);
}
