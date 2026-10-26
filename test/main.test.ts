import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store';
import * as gateway from '../src/main/gateway';
import * as routines from '../src/main/routines';
import * as tools from '../src/main/tools';
import * as plugins from '../src/main/plugins';
import { pendingPrompt, mentionedBots } from '../src/main/transcript';
import { substitute, toSdkConfig } from '../src/main/mcp';
import * as providers from '../src/main/providers';
import * as rename from '../src/main/rename';
import * as xlsx from '../src/main/xlsx';
import { searchMessages } from '../src/shared/search';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { McpServer, Message, Provider, Rule } from '../src/shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'characterbot-test-'));

// store: defaults, round trip, legacy migration
const file = path.join(tmp, 'state.json');
assert.equal(store.load(file).bots[0].name, 'Octo');
const s = store.defaultState();
store.save(file, s);
assert.deepEqual(store.load(file), s);
fs.writeFileSync(file, JSON.stringify({ settings: { baseUrl: 'x' }, agents: [{ id: 'a1', name: 'RO', color: '#f00', systemPrompt: 'p', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] }] }));
const migrated = store.load(file);
assert.equal(migrated.bots[0].id, 'a1');
assert.equal(migrated.convs[0].messages[1].botId, 'a1');
assert.deepEqual(migrated.bots[0].memories, []);
assert.equal(migrated.settings.model, '');
assert.equal(migrated.settings.onboarded, true); // saved before first-run setup existed
assert.equal(store.defaultState().settings.onboarded, false);
assert.equal((migrated.settings as unknown as Record<string, unknown>).baseUrl, undefined);

// gateway: deny beats allow, defaults, workspace writes, routine fails closed, broken regex never widens
const call = { name: 'Bash', args: { command: 'rm -rf /' }, botId: 'b1' };
assert.equal(gateway.decide(call).effect, 'allow');
assert.equal(gateway.decide(call, [], { Bash: 'ask' }).effect, 'ask');
assert.equal(gateway.decide({ ...call, name: 'Read' }).effect, 'allow');
assert.equal(gateway.decide({ ...call, name: 'mcp__characterbot__ask_user' }).effect, 'allow');
assert.equal(gateway.decide({ ...call, name: 'mcp__github__create_issue' }).effect, 'ask');
assert.equal(gateway.decide({ ...call, name: 'Write', args: { file_path: 'out/a.md' } }).effect, 'allow');
assert.equal(gateway.decide({ ...call, name: 'Write', args: { file_path: '/etc/hosts' } }).effect, 'allow');
assert.equal(gateway.decide({ ...call, name: 'Edit', args: { file_path: '../x' } }).effect, 'allow');
const rules: Rule[] = [{ id: 'r1', effect: 'allow', tool: 'Bash' }, { id: 'r2', effect: 'deny', tool: 'Ba*', match: 'rm -rf' }];
assert.equal(gateway.decide(call, rules).effect, 'deny');
assert.equal(gateway.decide({ ...call, args: { command: 'ls' } }, rules).effect, 'allow');
const askBash = { Bash: 'ask' } as const;
assert.equal(gateway.decide({ ...call, initiator: 'routine' as const }, [], askBash).effect, 'deny');
assert.equal(gateway.decide(call, [{ id: 'r3', effect: 'allow', tool: '*', match: '(' }], askBash).effect, 'ask');
assert.equal(gateway.decide(call, [{ id: 'r4', effect: 'allow', tool: '*', botId: 'other' }], askBash).effect, 'ask');
assert.equal(gateway.maskSecrets('token=abcd1234', ['abcd1234']), 'token=••••');

// routines
const routineBase = { id: 'r', convId: 'c', botId: 'b', prompt: 'p', failures: 0 };
assert.throws(() => routines.validateSchedule({ every_minutes: 5 }));
assert.throws(() => routines.validateSchedule({ daily_time: '25:00' }));
const base = new Date(2026, 0, 1, 10, 0).getTime();
const interval = { ...routineBase, enabled: true, createdAt: base, lastRun: 0, schedule: routines.validateSchedule({ every_minutes: 30 }) };
assert.equal(routines.isDue(interval, base + 29 * 60_000), false);
assert.equal(routines.isDue(interval, base + 30 * 60_000), true);
const daily = { ...routineBase, enabled: true, createdAt: base, lastRun: 0, schedule: routines.validateSchedule({ daily_time: '09:00' }) };
assert.equal(routines.nextRun(daily), new Date(2026, 0, 2, 9, 0).getTime());

// event triggers never fire from the clock
const hook = routines.validateSchedule({ webhook: true });
assert.equal(hook.type, 'webhook');
assert.equal(routines.isDue({ ...routineBase, enabled: true, createdAt: 0, lastRun: 0, schedule: hook }, Date.now()), false);
assert.equal(routines.validateSchedule({ watch_path: os.tmpdir() }).type, 'file');
assert.throws(() => routines.validateSchedule({ watch_path: '/nope/missing' }));
assert.throws(() => routines.validateSchedule({ github_repo: 'not a repo' }));
assert.equal(routines.describe({ type: 'github', repo: 'a/b' }), 'a/b PR이 열리거나 업데이트될 때');

// tools: workspace confinement and library listing (dot folders hidden)
const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
assert.throws(() => tools.inside(ws, '../escape'));
fs.mkdirSync(path.join(ws, 'out'));
fs.writeFileSync(path.join(ws, 'out', 'a.md'), '# hi');
fs.mkdirSync(path.join(ws, '.claude'));
fs.writeFileSync(path.join(ws, '.claude', 'x'), '');
assert.deepEqual(tools.listFiles(ws).map((f) => f.path), [path.join('out', 'a.md')]);

// transcript: a bot's next prompt is everything it hasn't seen, minus its own replies
const bots = [{ id: 'b1', name: 'RO Agent' }, { id: 'b2', name: 'RO' }].map((b, i) => ({ ...store.newBot(b.name, i), id: b.id }));
const msg = (m: Partial<Message> & Pick<Message, 'role' | 'content'>): Message => ({ id: 'm', ts: 0, ...m });
const conv = {
  kind: 'group' as const,
  messages: [
    msg({ role: 'user', content: 'hi', attachments: [{ name: 'n.txt', text: 'note' }, { name: 'p.png', dataUrl: 'data:image/png;base64,AAA=' }] }),
    msg({ role: 'assistant', botId: 'b2', content: 'from b2' }),
    msg({ role: 'tool', botId: 'b2', content: 'secret listing' }),
    msg({ role: 'assistant', botId: 'b1', content: 'mine' }),
    msg({ role: 'assistant', botId: 'b2', content: '', error: 'x' }),
  ],
};
const p1 = pendingPrompt(conv, 'b1', { bots, userName: '명기' });
assert.match(p1.text, /^명기: hi[\s\S]*note[\s\S]*\[RO\]: from b2$/);
assert.deepEqual(p1.images, [{ mediaType: 'image/png', data: 'AAA=' }]);
assert.equal(pendingPrompt(conv, 'b1', { bots, userName: '명기' }, 3).text, '');
assert.equal(pendingPrompt({ kind: 'dm', messages: [msg({ role: 'user', content: 'yo' })] }, 'b1', { bots, userName: '명기' }).text, 'yo');
assert.deepEqual(mentionedBots('@RO 그리고 @RO Agent 확인', bots), ['b2', 'b1']);
assert.deepEqual(mentionedBots('@ro agent만', bots), ['b1']);

// plugins: Claude Code layout with .mcp.json and SKILL.md frontmatter
const pdir = path.join(tmp, 'plug');
fs.mkdirSync(path.join(pdir, '.claude-plugin'), { recursive: true });
fs.mkdirSync(path.join(pdir, 'skills', 'review'), { recursive: true });
fs.writeFileSync(path.join(pdir, '.claude-plugin', 'plugin.json'), '{"name":"demo","description":"d"}');
fs.writeFileSync(path.join(pdir, '.mcp.json'), '{"mcpServers":{"srv":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/s.js"]}}}');
fs.writeFileSync(path.join(pdir, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: "Review code"\n---\nDo it.');
const plugin = plugins.readPlugin(pdir);
assert.equal((plugin.mcpServers.srv.args as string[])[0], `${pdir}/s.js`);
assert.deepEqual(plugin.skills, [{ name: 'review', description: 'Review code', body: 'Do it.' }]);

// mcp: secret substitution and SDK config shape
assert.deepEqual(substitute({ env: { T: '${GH}' }, args: ['x${GH}'] }, { GH: 'tok' }), { env: { T: 'tok' }, args: ['xtok'] });
process.env.CB_TEST_ENV = 'leak';
assert.equal(substitute('${CB_TEST_ENV}', {}), ''); // never falls back to process.env
assert.deepEqual(toSdkConfig([
  { id: 'm1', name: 'my server', source: 'user', enabled: true, command: 'npx', args: ['x'], env: { T: '${GH}' } },
  { id: 'm2', name: 'gh', source: 'user', enabled: true, url: 'https://x/mcp', headers: { A: 'Bearer ${GH}' } },
  { id: 'm3', name: 'off', source: 'user', enabled: false, command: 'x' },
], ['m1', 'm2', 'm3'], { GH: 'tok' }), {
  my_server: { type: 'stdio', command: 'npx', args: ['x'], env: { T: 'tok' } },
  gh: { type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer tok' } },
});

// OAuth servers: left out until signed in, then sent with the bearer token.
const remote: McpServer = { id: 'o', name: 'linear', url: 'https://mcp.linear.app/mcp', oauth: {}, enabled: true, source: 'user' };
assert.deepEqual(toSdkConfig([remote], ['o'], {}, {}), {});
assert.deepEqual(toSdkConfig([remote], ['o'], {}, { o: 'tok' }), { linear: { type: 'http', url: remote.url, headers: { Authorization: 'Bearer tok' } } });

// Providers pick the SDK's auth: the Claude login, an API key, or a custom endpoint.
const envBase = { PATH: '/bin', ANTHROPIC_API_KEY: 'leak' };
const prov = (p: Partial<Provider> & Pick<Provider, 'kind'>): Provider => ({ id: 'p', name: 'P', ...p });
assert.deepEqual(providers.env(envBase, prov({ kind: 'claude' }), undefined), { PATH: '/bin' });
assert.equal(providers.env(envBase, prov({ kind: 'anthropic' }), 'k').ANTHROPIC_API_KEY, 'k');
assert.deepEqual(providers.env(envBase, prov({ kind: 'custom', baseUrl: 'https://g.example' }), 't'), { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://g.example', ANTHROPIC_AUTH_TOKEN: 't' });
assert.throws(() => providers.env(envBase, prov({ kind: 'anthropic', name: 'Anthropic' }), undefined));
// stored secret names never reach a bot, even when the shell exported them
assert.deepEqual(providers.env({ PATH: '/bin', MY_TOKEN: 'host' }, prov({ kind: 'anthropic' }), 'k', ['MY_TOKEN']), { PATH: '/bin', ANTHROPIC_API_KEY: 'k' });

// Full permissions by default, but external-app writes ask first.
assert.equal(gateway.decide({ name: 'mcp__claude_ai_Google_Calendar__list_events', args: {} }).effect, 'allow');
assert.equal(gateway.decide({ name: 'mcp__notion__notion-create-pages', args: {} }).effect, 'ask');
assert.equal(gateway.decide({ name: 'mcp__claude_ai_Notion__notion-fetch', args: {} }).effect, 'allow');
assert.equal(gateway.decide({ name: 'mcp__claude_ai_Slack__slack_search_public_and_private', args: {} }).effect, 'allow');
assert.equal(gateway.decide({ name: 'mcp__claude_ai_Slack__slack_send_message', args: {} }).effect, 'ask');
assert.equal(gateway.decide({ name: 'mcp__Gmail__delete_email', args: {} }).effect, 'ask');

// Writes to account-linked apps (claude.ai connectors, remote servers) are blocked; local servers aren't.
assert.equal(gateway.accountWrite('mcp__claude_ai_Slack__slack_send_message'), true);
assert.equal(gateway.accountWrite('mcp__claude_ai_Gmail__send_email'), true);
assert.equal(gateway.accountWrite('mcp__claude_ai_Slack__slack_search_public'), false);
assert.equal(gateway.accountWrite('mcp__linear__create_issue', ['linear']), true);
assert.equal(gateway.accountWrite('mcp__echo__post_note', ['linear']), false);
assert.equal(gateway.accountWrite('mcp__characterbot__remember'), false);

// rename: a v0.1.x CharacterBot folder moves to PixelBot with its paths and Claude sessions.
{
  const from = path.join(tmp, 'CharacterBot');
  const to = path.join(tmp, 'PixelBot');
  const projects = path.join(tmp, 'projects');
  fs.mkdirSync(path.join(from, 'workspaces', 'bot_a'), { recursive: true });
  fs.writeFileSync(path.join(from, 'state.json'), JSON.stringify({ dir: path.join(from, 'workspaces', 'bot_a'), other: `${from} Dev/x` }));
  const key = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-');
  fs.mkdirSync(path.join(projects, `${key(from)}-workspaces-bot-a`), { recursive: true });
  fs.mkdirSync(path.join(to, 'Cache'), { recursive: true }); // made by Chromium before main runs
  assert.equal(rename.moveDataDir(from, to, projects), true);
  assert.equal(fs.existsSync(from), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(to, 'state.json'), 'utf8')), { dir: path.join(to, 'workspaces', 'bot_a'), other: `${from} Dev/x` });
  assert.deepEqual(fs.readdirSync(projects), [`${key(to)}-workspaces-bot-a`]);
  assert.equal(rename.moveDataDir(from, to, projects), false); // only once
  // Chromium v10 blob made with the old Keychain password decrypts; a wrong one doesn't.
  const k = crypto.pbkdf2Sync('old-pass', 'saltysalt', 1003, 16, 'sha1');
  const c = crypto.createCipheriv('aes-128-cbc', k, Buffer.alloc(16, ' '));
  const blob = Buffer.concat([Buffer.from('v10'), c.update('{"A":"1"}'), c.final()]);
  assert.equal(rename.decryptLegacy(blob, 'old-pass'), '{"A":"1"}');
  assert.equal(rename.decryptLegacy(blob, 'wrong'), null);
}

// Workspace paths can't escape through symlinks; runnable files are detected.
{
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(path.join(ws, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'note.md'), 'hi');
  fs.writeFileSync(path.join(ws, 'run.command'), 'echo');
  fs.writeFileSync(path.join(ws, 'tool'), 'x', { mode: 0o755 });
  fs.symlinkSync(os.homedir(), path.join(ws, 'home'));
  fs.symlinkSync(path.join(tmp, 'missing'), path.join(ws, 'dangling'));
  fs.symlinkSync(path.join(ws, 'note.md'), path.join(ws, 'sub', 'ok-link'));
  assert.equal(tools.inside(ws, 'note.md'), path.join(ws, 'note.md'));
  assert.equal(tools.inside(ws, 'new/dir/file.txt'), path.join(ws, 'new/dir/file.txt')); // not created yet
  assert.equal(tools.inside(ws, 'sub/ok-link'), path.join(ws, 'sub/ok-link'));
  assert.throws(() => tools.inside(ws, 'home/.ssh/id_ed25519'));
  assert.throws(() => tools.inside(ws, 'home'));
  assert.throws(() => tools.inside(ws, 'dangling'));
  assert.throws(() => tools.inside(ws, '../x'));
  assert.equal(tools.runnable(path.join(ws, 'note.md')), false);
  assert.equal(tools.runnable(path.join(ws, 'run.command')), true);
  assert.equal(tools.runnable(path.join(ws, 'tool')), true);
  assert.equal(tools.runnable(path.join(ws, 'sub')), true);
}

// Credentials ask first even with full access; ordinary work and file contents don't.
assert.equal(gateway.sensitive({ name: 'Bash', args: { command: 'cat ~/.ssh/id_ed25519' } }), true);
assert.equal(gateway.sensitive({ name: 'Bash', args: { command: 'security find-generic-password -w -s x' } }), true);
assert.equal(gateway.sensitive({ name: 'Read', args: { file_path: '/Users/a/Library/Application Support/Google/Chrome/Default/Cookies' } }), true);
assert.equal(gateway.sensitive({ name: 'Read', args: { file_path: '/Users/a/Library/Application Support/PixelBot/secrets.bin' } }), true);
assert.equal(gateway.sensitive({ name: 'Read', args: { file_path: '/Users/a/Library/Application Support/PixelBot/workspaces/bot_1/report.md' } }), false);
assert.equal(gateway.sensitive({ name: 'Bash', args: { command: 'npm test && git status' } }), false);
assert.equal(gateway.sensitive({ name: 'Write', args: { file_path: '/tmp/r.md', content: 'security findings: rotate ~/.ssh keys' } }), false);
assert.equal(gateway.sensitive({ name: 'mcp__echo__get', args: { q: '.ssh/' } }), false);

// Message search: every word, newest first, no tool entries or hidden briefs.
{
  const msg = (id: string, ts: number, content: string, extra: Partial<Message> = {}): Message => ({ id, ts, role: 'user', content, ...extra });
  const a = { ...store.newConv('dm', ['b1']), messages: [msg('m1', 1, '서울 날씨 알려줘'), msg('m2', 3, '부산 날씨는 맑아요', { role: 'assistant' }), msg('t1', 4, '날씨 API 결과', { role: 'tool' })] };
  const b = { ...store.newConv('group', ['b2'], '팀'), messages: [msg('m3', 2, 'Weather in Seoul'), msg('m4', 5, '날씨 브리핑', { brief: true })] };
  assert.deepEqual(searchMessages([a, b], '날씨').map((x) => x.msg.id), ['m2', 'm1']);
  assert.deepEqual(searchMessages([a, b], 'seoul WEATHER').map((x) => x.msg.id), ['m3']);
  assert.deepEqual(searchMessages([a, b], '  '), []);
  assert.ok(searchMessages([{ ...a, messages: [msg('long', 1, `${'가'.repeat(100)} 목표 ${'나'.repeat(200)}`)] }], '목표')[0].snippet.startsWith('…'));
}

// xlsx: shared and inline strings, gaps in rows and columns, sheet order, a real file through unzip.
// Async (unzip runs as a child process); "ok" waits for it.
const xlsxDone = (async () => {
  const strings = xlsx.sharedStrings('<sst><si><t>이름</t></si><si><r><t>A&amp;</t></r><r><t xml:space="preserve">B</t></r></si></sst>');
  assert.deepEqual(strings, ['이름', 'A&B']);
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="3"><c r="B3"><v>3.5</v></c><c r="C3" t="inlineStr"><is><t>&lt;x&gt;</t></is></c><c r="D3" t="b"><v>1</v></c></row></sheetData></worksheet>';
  assert.deepEqual(xlsx.sheetRows(sheet, strings), [['이름', '', 'A&B'], [], ['', '3.5', '<x>', 'TRUE']]);
  assert.equal(xlsx.sheetRows(sheet, strings, 1).length, 1);
  const workbook = '<workbook><sheets><sheet name="두번째" sheetId="2" r:id="rId2"/><sheet name="Q&amp;A" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
  assert.deepEqual(xlsx.sheetParts(workbook, rels), [{ name: '두번째', part: 'xl/worksheets/sheet2.xml' }, { name: 'Q&A', part: 'xl/worksheets/sheet1.xml' }]);
  const dir = fs.mkdtempSync(path.join(tmp, 'xlsx-'));
  fs.mkdirSync(path.join(dir, 'xl/_rels'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'xl/worksheets'));
  fs.writeFileSync(path.join(dir, 'xl/workbook.xml'), workbook);
  fs.writeFileSync(path.join(dir, 'xl/_rels/workbook.xml.rels'), rels);
  fs.writeFileSync(path.join(dir, 'xl/sharedStrings.xml'), '<sst><si><t>이름</t></si><si><t>A&amp;B</t></si></sst>');
  fs.writeFileSync(path.join(dir, 'xl/worksheets/sheet1.xml'), sheet);
  fs.writeFileSync(path.join(dir, 'xl/worksheets/sheet2.xml'), '<worksheet><sheetData/></worksheet>');
  execFileSync('/usr/bin/zip', ['-qr', path.join(tmp, 'book.xlsx'), 'xl'], { cwd: dir });
  assert.deepEqual(await xlsx.readXlsx(path.join(tmp, 'book.xlsx')), [{ name: '두번째', rows: [] }, { name: 'Q&A', rows: [['이름', '', 'A&B'], [], ['', '3.5', '<x>', 'TRUE']] }]);
  assert.deepEqual(await xlsx.readXlsx(path.join(tmp, 'missing.xlsx')), []);
  // Namespace prefixes and "../" relationship targets.
  assert.deepEqual(xlsx.sharedStrings('<x:sst><x:si><x:t>a</x:t></x:si></x:sst>'), ['a']);
  assert.deepEqual(xlsx.sheetRows('<x:sheetData><x:row r="1"><x:c r="B1"><x:v>7</x:v></x:c></x:row></x:sheetData>', []), [['', '7']]);
  assert.deepEqual(xlsx.sheetParts('<x:sheets><x:sheet name="S" r:id="r1"/></x:sheets>', '<Relationship Id="r1" Target="../xl/worksheets/s.xml"/>'), [{ name: 'S', part: 'xl/worksheets/s.xml' }]);
  assert.deepEqual(xlsx.sheetParts('<sheet name="S" r:id="r1"/>', '<Relationship Id="r1" Target="../../etc/x.xml"/>'), []);
})();

// Pixel avatars render for every shape and size.
(globalThis as unknown as { document: unknown }).document = { addEventListener() {} };
// require, not import: ui.ts touches document when it loads.
const ui = require('../src/renderer/ui') as typeof import('../src/renderer/ui');
for (let i = 0; i < ui.SHAPE_COUNT; i++) for (const size of [18, 40, 96]) {
  const svg = ui.avatarSvg(i, '#2f7cf6', size);
  assert.ok(svg.includes('crispEdges') && (svg.match(/class="eye"/g) || []).length === 2, `shape ${i}`);
}
assert.ok(!ui.avatarSvg(0, '#999', 40, { sleeping: true }).includes('class="eye"'));

xlsxDone.then(() => console.log('ok'));
