// Connected apps (MCP servers). The agent SDK opens them itself for each turn;
// here we only probe each one once to show its status and tool list.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { McpServer, McpStatus } from '../shared/types';

export type Secrets = Record<string, string>;
export type Tokens = Record<string, string>;

const slug = (s: string): string => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

// Replaces ${NAME} with stored secrets (설정 › 시크릿 only, never process.env)
// so tokens never live in the config.
function substitute<T>(value: T, secrets: Secrets): T;
function substitute(value: unknown, secrets: Secrets): unknown {
  if (typeof value === 'string') return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, k) => secrets[k] ?? '');
  if (Array.isArray(value)) return value.map((v) => substitute(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, secrets)]));
  return value;
}

// Headers for a remote server, with the OAuth access token when it signs in that way.
const headersOf = (cfg: McpServer, token?: string): Record<string, string> => ({ ...cfg.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) });

// SDK `mcpServers` option for the servers a bot may use. `tokens`: server id ->
// OAuth access token; OAuth servers without one are left out until signed in.
function toSdkConfig(servers: McpServer[], serverIds: string[], secrets: Secrets, tokens: Tokens = {}): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const server of servers) {
    if (!server.enabled || !serverIds.includes(server.id)) continue;
    if (server.oauth && !tokens[server.id]) continue;
    const cfg = substitute(server, secrets);
    out[slug(server.name)] = cfg.url
      ? { type: 'http', url: cfg.url, headers: headersOf(cfg, tokens[server.id]) }
      : { type: 'stdio', command: cfg.command || '', args: cfg.args || [], env: cfg.env || {} };
  }
  return out;
}

// True when a remote server refused us for lack of a token (HTTP 401).
const unauthorized = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: string } | null;
  return e?.code === 401 || /\b401\b|unauthorized/i.test(e?.message || '');
};

interface Probe {
  key: string;
  status: string;
  tools: string[];
  error?: string;
}
const probes = new Map<string, Probe>(); // server id -> last probe

async function probe(server: McpServer, secrets: Secrets, token?: string): Promise<string[]> {
  const cfg = substitute(server, secrets);
  const transport = cfg.url
    ? new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: headersOf(cfg, token) } })
    : new StdioClientTransport({ command: cfg.command || '', args: cfg.args || [], env: { ...getDefaultEnvironment(), ...cfg.env }, stderr: 'ignore' });
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
async function sync(servers: McpServer[], secrets: Secrets, tokens: Tokens, onChange: () => void): Promise<void> {
  const ids = new Set(servers.map((s) => s.id));
  for (const id of probes.keys()) if (!ids.has(id)) probes.delete(id);
  await Promise.all(servers.map(async (server) => {
    const key = JSON.stringify([server, Object.keys(secrets), tokens[server.id]]);
    if (probes.get(server.id)?.key === key) return;
    if (!server.enabled) return void probes.set(server.id, { key, status: 'off', tools: [] });
    if (server.oauth && !tokens[server.id]) return void probes.set(server.id, { key, status: 'auth', tools: [] });
    const entry: Probe = { key, status: 'connecting', tools: [] };
    probes.set(server.id, entry);
    onChange();
    try {
      Object.assign(entry, { status: 'connected', tools: await probe(server, secrets, tokens[server.id]) });
    } catch (err) {
      Object.assign(entry, unauthorized(err) ? { status: 'auth' } : { status: 'error', error: (err as Error).message });
    }
    onChange();
  }));
}

function status(): Record<string, McpStatus> {
  return Object.fromEntries([...probes].map(([id, p]) => [id, { status: p.status, error: p.error, tools: p.tools }]));
}

export { sync, status, toSdkConfig, substitute, slug, probe, unauthorized };
