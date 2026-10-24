const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store.cjs');
const gateway = require('./gateway.cjs');
const routines = require('./routines.cjs');
const tools = require('./tools.cjs');
const plugins = require('./plugins.cjs');
const { pendingPrompt, mentionedBots } = require('./transcript.cjs');
const { substitute, toSdkConfig } = require('./mcp.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grokbot-test-'));

// store: defaults, round trip, legacy migration
const file = path.join(tmp, 'state.json');
assert.equal(store.load(file).bots[0].name, 'Grok');
const s = store.defaultState();
store.save(file, s);
assert.deepEqual(store.load(file), s);
fs.writeFileSync(file, JSON.stringify({ settings: { model: 'grok-4', baseUrl: 'x' }, agents: [{ id: 'a1', name: 'RO', color: '#f00', systemPrompt: 'p', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] }] }));
const migrated = store.load(file);
assert.equal(migrated.bots[0].id, 'a1');
assert.equal(migrated.convs[0].messages[1].botId, 'a1');
assert.deepEqual(migrated.bots[0].memories, []);
assert.equal(migrated.settings.model, '');
assert.equal(migrated.settings.baseUrl, undefined);

// gateway: deny beats allow, defaults, workspace writes, routine fails closed, broken regex never widens
const ws0 = '/tmp/ws-bot';
const call = { name: 'Bash', args: { command: 'rm -rf /' }, botId: 'b1' };
assert.equal(gateway.decide(call).effect, 'allow');
assert.equal(gateway.decide(call, [], null, { Bash: 'ask' }).effect, 'ask');
assert.equal(gateway.decide({ ...call, name: 'Read' }).effect, 'allow');
assert.equal(gateway.decide({ ...call, name: 'mcp__grokbot__ask_user' }).effect, 'allow');
assert.equal(gateway.decide({ ...call, name: 'mcp__github__create_issue' }).effect, 'ask');
assert.equal(gateway.decide({ ...call, name: 'Write', args: { file_path: 'out/a.md' } }, [], ws0).effect, 'allow');
assert.equal(gateway.decide({ ...call, name: 'Write', args: { file_path: '/etc/hosts' } }, [], ws0).effect, 'allow');
assert.equal(gateway.decide({ ...call, name: 'Edit', args: { file_path: '../x' } }, [], ws0).effect, 'allow');
const rules = [{ effect: 'allow', tool: 'Bash' }, { effect: 'deny', tool: 'Ba*', match: 'rm -rf' }];
assert.equal(gateway.decide(call, rules).effect, 'deny');
assert.equal(gateway.decide({ ...call, args: { command: 'ls' } }, rules).effect, 'allow');
const askBash = { Bash: 'ask' };
assert.equal(gateway.decide({ ...call, initiator: 'routine' }, [], null, askBash).effect, 'deny');
assert.equal(gateway.decide(call, [{ effect: 'allow', tool: '*', match: '(' }], null, askBash).effect, 'ask');
assert.equal(gateway.decide(call, [{ effect: 'allow', tool: '*', botId: 'other' }], null, askBash).effect, 'ask');
assert.equal(gateway.maskSecrets('token=abcd1234', ['abcd1234']), 'token=••••');

// routines
assert.throws(() => routines.validateSchedule({ every_minutes: 5 }));
assert.throws(() => routines.validateSchedule({ daily_time: '25:00' }));
const base = new Date(2026, 0, 1, 10, 0).getTime();
const interval = { enabled: true, createdAt: base, lastRun: 0, schedule: routines.validateSchedule({ every_minutes: 30 }) };
assert.equal(routines.isDue(interval, base + 29 * 60_000), false);
assert.equal(routines.isDue(interval, base + 30 * 60_000), true);
const daily = { enabled: true, createdAt: base, lastRun: 0, schedule: routines.validateSchedule({ daily_time: '09:00' }) };
assert.equal(routines.nextRun(daily), new Date(2026, 0, 2, 9, 0).getTime());

// event triggers never fire from the clock
const hook = routines.validateSchedule({ webhook: true });
assert.equal(hook.type, 'webhook');
assert.equal(routines.isDue({ enabled: true, createdAt: 0, lastRun: 0, schedule: hook }, Date.now()), false);
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
const bots = [{ id: 'b1', name: 'RO Agent' }, { id: 'b2', name: 'RO' }];
const conv = {
  kind: 'group',
  messages: [
    { role: 'user', content: 'hi', attachments: [{ name: 'n.txt', text: 'note' }, { name: 'p.png', dataUrl: 'data:image/png;base64,AAA=' }] },
    { role: 'assistant', botId: 'b2', content: 'from b2' },
    { role: 'tool', botId: 'b2', content: 'secret listing' },
    { role: 'assistant', botId: 'b1', content: 'mine' },
    { role: 'assistant', botId: 'b2', content: '', error: 'x' },
  ],
};
const p1 = pendingPrompt(conv, 'b1', { bots, userName: '명기' });
assert.match(p1.text, /^명기: hi[\s\S]*note[\s\S]*\[RO\]: from b2$/);
assert.deepEqual(p1.images, [{ mediaType: 'image/png', data: 'AAA=' }]);
assert.equal(pendingPrompt(conv, 'b1', { bots, userName: '명기' }, 3).text, '');
assert.equal(pendingPrompt({ kind: 'dm', messages: [{ role: 'user', content: 'yo' }] }, 'b1', { bots, userName: '명기' }).text, 'yo');
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
assert.equal(plugin.mcpServers.srv.args[0], `${pdir}/s.js`);
assert.deepEqual(plugin.skills, [{ name: 'review', description: 'Review code', body: 'Do it.' }]);

// mcp: secret substitution and SDK config shape
assert.deepEqual(substitute({ env: { T: '${GH}' }, args: ['x${GH}'] }, { GH: 'tok' }), { env: { T: 'tok' }, args: ['xtok'] });
assert.deepEqual(toSdkConfig([
  { id: 'm1', name: 'my server', enabled: true, command: 'npx', args: ['x'], env: { T: '${GH}' } },
  { id: 'm2', name: 'gh', enabled: true, url: 'https://x/mcp', headers: { A: 'Bearer ${GH}' } },
  { id: 'm3', name: 'off', enabled: false, command: 'x' },
], ['m1', 'm2', 'm3'], { GH: 'tok' }), {
  my_server: { type: 'stdio', command: 'npx', args: ['x'], env: { T: 'tok' } },
  gh: { type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer tok' } },
});

// OAuth servers: left out until signed in, then sent with the bearer token.
const remote = { id: 'o', name: 'linear', url: 'https://mcp.linear.app/mcp', oauth: {}, enabled: true };
assert.deepEqual(toSdkConfig([remote], ['o'], {}, {}), {});
assert.deepEqual(toSdkConfig([remote], ['o'], {}, { o: 'tok' }), { linear: { type: 'http', url: remote.url, headers: { Authorization: 'Bearer tok' } } });

// Providers pick the SDK's auth: the Claude login, an API key, or a custom endpoint.
const providers = require('./providers.cjs');
const envBase = { PATH: '/bin', ANTHROPIC_API_KEY: 'leak' };
assert.deepEqual(providers.env(envBase, { kind: 'claude' }), { PATH: '/bin' });
assert.equal(providers.env(envBase, { kind: 'anthropic' }, 'k').ANTHROPIC_API_KEY, 'k');
assert.deepEqual(providers.env(envBase, { kind: 'custom', baseUrl: 'https://g.example' }, 't'), { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://g.example', ANTHROPIC_AUTH_TOKEN: 't' });
assert.throws(() => providers.env(envBase, { kind: 'anthropic', name: 'Anthropic' }));

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
assert.equal(gateway.accountWrite('mcp__grokbot__remember'), false);

console.log('ok');
