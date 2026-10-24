// Connected apps (MCP servers). The agent SDK opens them itself for each turn;
// here we only probe each one once to show its status and tool list.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const slug = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

// Replaces ${NAME} with secret values so tokens never live in the config.
function substitute(value, secrets) {
  if (typeof value === 'string') return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, k) => secrets[k] ?? process.env[k] ?? '');
  if (Array.isArray(value)) return value.map((v) => substitute(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, secrets)]));
  return value;
}

// Headers for a remote server, with the OAuth access token when it signs in that way.
const headersOf = (cfg, token) => ({ ...cfg.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) });

// SDK `mcpServers` option for the servers a bot may use. `tokens`: server id ->
// OAuth access token; OAuth servers without one are left out until signed in.
function toSdkConfig(servers, serverIds, secrets, tokens = {}) {
  const out = {};
  for (const server of servers) {
    if (!server.enabled || !serverIds.includes(server.id)) continue;
    if (server.oauth && !tokens[server.id]) continue;
    const cfg = substitute(server, secrets);
    out[slug(server.name)] = cfg.url
      ? { type: 'http', url: cfg.url, headers: headersOf(cfg, tokens[server.id]) }
      : { type: 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env || {} };
  }
  return out;
}

// True when a remote server refused us for lack of a token (HTTP 401).
const unauthorized = (err) => err?.code === 401 || /\b401\b|unauthorized/i.test(err?.message || '');

const probes = new Map(); // server id -> { key, status, tools, error }

async function probe(server, secrets, token) {
  const cfg = substitute(server, secrets);
  const transport = cfg.url
    ? new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: headersOf(cfg, token) } })
    : new StdioClientTransport({ command: cfg.command, args: cfg.args || [], env: { ...getDefaultEnvironment(), ...cfg.env }, stderr: 'ignore' });
  const client = new Client({ name: 'characterbot', version: '0.1.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  } finally {
    client.close().catch(() => {});
  }
}

// Re-probes servers whose config changed; drops removed ones.
async function sync(servers, secrets, tokens, onChange) {
  const ids = new Set(servers.map((s) => s.id));
  for (const id of probes.keys()) if (!ids.has(id)) probes.delete(id);
  await Promise.all(servers.map(async (server) => {
    const key = JSON.stringify([server, Object.keys(secrets), tokens[server.id]]);
    if (probes.get(server.id)?.key === key) return;
    if (!server.enabled) return probes.set(server.id, { key, status: 'off', tools: [] });
    if (server.oauth && !tokens[server.id]) return probes.set(server.id, { key, status: 'auth', tools: [] });
    const entry = { key, status: 'connecting', tools: [] };
    probes.set(server.id, entry);
    onChange();
    try {
      Object.assign(entry, { status: 'connected', tools: await probe(server, secrets, tokens[server.id]) });
    } catch (err) {
      Object.assign(entry, unauthorized(err) ? { status: 'auth' } : { status: 'error', error: err.message });
    }
    onChange();
  }));
}

function status() {
  return Object.fromEntries([...probes].map(([id, p]) => [id, { status: p.status, error: p.error, tools: p.tools }]));
}

module.exports = { sync, status, toSdkConfig, substitute, slug, probe, unauthorized };
