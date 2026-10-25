// OAuth sign-in for remote MCP servers (MCP authorization spec: protected-resource
// discovery, dynamic client registration, PKCE). The browser redirects back to a
// short-lived loopback listener. Servers without dynamic registration (Google)
// use a client the user created; its redirect URI must be REDIRECT_URI.
import http from 'node:http';
import crypto from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpServer, OauthConfig } from '../shared/types';

// What secrets.bin keeps per signed-in server.
export interface OauthRecord {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  expiresAt?: number | null;
}
export type OauthClient = { client_id: string; client_secret?: string } | null;

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;

// Per-host sign-in rules. Hosts not listed register a client on
// the fly (dynamic registration) and are only signed in when they answer 401.
// static: only pre-registered clients are accepted; `provider` names whose client.
// always: sign in even though the server lists tools without a token.
const G = 'https://www.googleapis.com/auth/';
const google = (...scopes: string[]): OauthConfig => ({ registration: 'static', provider: 'google', always: true, scope: scopes.map((s) => G + s).join(' '), params: { access_type: 'offline', prompt: 'select_account consent' } });
const HOSTS: Record<string, OauthConfig> = {
  'gmailmcp.googleapis.com': google('gmail.readonly', 'gmail.compose', 'gmail.modify'),
  'calendarmcp.googleapis.com': google('calendar.events', 'calendar.calendarlist.readonly', 'calendar.events.readonly', 'calendar.events.freebusy'),
  'drivemcp.googleapis.com': google('drive.readonly', 'drive.file'),
  'docsmcp.googleapis.com': google('documents'),
  'sheetsmcp.googleapis.com': google('spreadsheets'),
  'slidesmcp.googleapis.com': google('presentations'),
  'chatmcp.googleapis.com': google('chat.spaces.readonly', 'chat.memberships.readonly', 'chat.messages.readonly', 'chat.messages.create'),
};
const configFor = (url: string): OauthConfig | null => HOSTS[new URL(url).hostname] || null;

// rec: the server's persisted { client, tokens, expiresAt }; save() persists it.
// client: a pre-registered { client_id, client_secret } or null for registration.
function provider(server: McpServer, rec: OauthRecord, save: () => void, client: OauthClient, openUrl: (url: string) => void): OAuthClientProvider & { expectedState: string } {
  let verifier = '';
  const state = crypto.randomBytes(16).toString('hex');
  return {
    state: () => state,
    redirectUrl: REDIRECT_URI,
    clientMetadata: {
      client_name: 'PixelBot',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    clientInformation: () => client || rec.client,
    saveClientInformation: (info) => { rec.client = info; save(); },
    tokens: () => rec.tokens,
    saveTokens: (tokens) => {
      // Refresh responses may omit the refresh token; keep the old one.
      rec.tokens = { ...tokens, refresh_token: tokens.refresh_token ?? rec.tokens?.refresh_token };
      rec.expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null;
      save();
    },
    redirectToAuthorization: (url) => {
      for (const [k, v] of Object.entries((server.oauth?.params || {}) as Record<string, string>)) url.searchParams.set(k, v);
      openUrl(url.href);
    },
    saveCodeVerifier: (v: string) => { verifier = v; },
    codeVerifier: () => verifier,
    expectedState: state,
  };
}

// Resolves with the `code` the browser brings back; rejects on error or timeout.
function listen(expectedState: string): { code: Promise<string>; close: () => void } {
  let finish: (err: Error | null, value?: string) => void = () => {};
  const servers: http.Server[] = [];
  const close = () => servers.forEach((s) => s.close());
  const code = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('로그인 시간이 초과됐어요')), 10 * 60_000);
    finish = (err, value) => { clearTimeout(timer); close(); if (err) reject(err); else resolve(value || ''); };
    const handler: http.RequestListener = (req, res) => {
      const url = new URL(req.url || '/', REDIRECT_URI);
      if (url.pathname !== '/oauth/callback') return void res.writeHead(404).end();
      const ok = url.searchParams.get('code') && url.searchParams.get('state') === expectedState;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(`<meta charset="utf-8"><body style="font:16px -apple-system;padding:48px">${ok ? '연결됐어요. 이 창을 닫고 앱으로 돌아가세요.' : '연결하지 못했어요. 앱에서 다시 시도해 주세요.'}</body>`);
      if (ok) finish(null, url.searchParams.get('code') || '');
      else finish(new Error(url.searchParams.get('error_description') || url.searchParams.get('error') || '잘못된 응답'));
    };
    // "localhost" may resolve to either address family.
    for (const host of ['127.0.0.1', '::1']) {
      const s = http.createServer(handler);
      s.on('error', (err) => { if (host === '127.0.0.1') finish(err); });
      s.listen(PORT, host);
      servers.push(s);
    }
  });
  code.catch(() => {});
  return { code, close };
}

// Full interactive sign-in. Resolves once tokens are saved.
async function connect(server: McpServer, rec: OauthRecord, save: () => void, client: OauthClient, openUrl: (url: string) => void): Promise<void> {
  if (!server.url) throw new Error('원격 MCP 서버가 아닙니다');
  const p = provider(server, rec, save, client, openUrl);
  const listener = listen(p.expectedState);
  try {
    const scope = server.oauth?.scope;
    if ((await auth(p, { serverUrl: server.url, scope })) === 'AUTHORIZED') return;
    await auth(p, { serverUrl: server.url, scope, authorizationCode: await listener.code });
  } finally {
    listener.close();
  }
}

const inflight = new Map<string, Promise<string | null>>();

// A valid access token, refreshing it when it is about to expire.
// Returns null when the user has to sign in again; never opens a browser.
function accessToken(server: McpServer, rec: OauthRecord, save: () => void, client: OauthClient): Promise<string | null> {
  if (!rec.tokens?.access_token) return Promise.resolve(null);
  if (!rec.expiresAt || rec.expiresAt - Date.now() > 60_000) return Promise.resolve(rec.tokens.access_token);
  if (!rec.tokens.refresh_token || !server.url) return Promise.resolve(null);
  if (!inflight.has(server.id)) {
    const p = provider(server, rec, save, client, () => { throw new Error('다시 로그인해야 해요'); });
    inflight.set(server.id, auth(p, { serverUrl: server.url, scope: server.oauth?.scope })
      .then((r) => (r === 'AUTHORIZED' ? rec.tokens?.access_token ?? null : null))
      .catch(() => null)
      .finally(() => inflight.delete(server.id)));
  }
  return inflight.get(server.id) ?? Promise.resolve(null);
}

export { connect, accessToken, configFor, REDIRECT_URI };
