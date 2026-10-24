// OAuth sign-in for remote MCP servers (MCP authorization spec: protected-resource
// discovery, dynamic client registration, PKCE). The browser redirects back to a
// short-lived loopback listener. Servers without dynamic registration (Google)
// use a client the user created; its redirect URI must be REDIRECT_URI.
const http = require('node:http');
const crypto = require('node:crypto');
const { auth } = require('@modelcontextprotocol/sdk/client/auth.js');

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;

// Per-host sign-in rules, as in Grok Bot. Hosts not listed register a client on
// the fly (dynamic registration) and are only signed in when they answer 401.
// static: only pre-registered clients are accepted; `provider` names whose client.
// always: sign in even though the server lists tools without a token.
const G = 'https://www.googleapis.com/auth/';
const google = (...scopes) => ({ registration: 'static', provider: 'google', always: true, scope: scopes.map((s) => G + s).join(' '), params: { access_type: 'offline', prompt: 'select_account consent' } });
const HOSTS = {
  'gmailmcp.googleapis.com': google('gmail.readonly', 'gmail.compose', 'gmail.modify'),
  'calendarmcp.googleapis.com': google('calendar.events', 'calendar.calendarlist.readonly', 'calendar.events.readonly', 'calendar.events.freebusy'),
  'drivemcp.googleapis.com': google('drive.readonly', 'drive.file'),
  'docsmcp.googleapis.com': google('documents'),
  'sheetsmcp.googleapis.com': google('spreadsheets'),
  'slidesmcp.googleapis.com': google('presentations'),
  'chatmcp.googleapis.com': google('chat.spaces.readonly', 'chat.memberships.readonly', 'chat.messages.readonly', 'chat.messages.create'),
};
const configFor = (url) => HOSTS[new URL(url).hostname] || null;

// rec: the server's persisted { client, tokens, expiresAt }; save() persists it.
// client: a pre-registered { client_id, client_secret } or null for registration.
function provider(server, rec, save, client, openUrl) {
  let verifier = '';
  const state = crypto.randomBytes(16).toString('hex');
  return {
    state: () => state,
    redirectUrl: REDIRECT_URI,
    clientMetadata: {
      client_name: 'CharacterBot',
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
      rec.tokens = { refresh_token: rec.tokens?.refresh_token, ...tokens };
      rec.expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null;
      save();
    },
    redirectToAuthorization: (url) => {
      for (const [k, v] of Object.entries(server.oauth?.params || {})) url.searchParams.set(k, v);
      openUrl(url.href);
    },
    saveCodeVerifier: (v) => { verifier = v; },
    codeVerifier: () => verifier,
    expectedState: state,
  };
}

// Resolves with the `code` the browser brings back; rejects on error or timeout.
function listen(expectedState) {
  let finish;
  const servers = [];
  const close = () => servers.forEach((s) => s.close());
  const code = new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('로그인 시간이 초과됐어요')), 10 * 60_000);
    finish = (err, value) => { clearTimeout(timer); close(); err ? reject(err) : resolve(value); };
    const handler = (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/oauth/callback') return res.writeHead(404).end();
      const ok = url.searchParams.get('code') && url.searchParams.get('state') === expectedState;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(`<meta charset="utf-8"><body style="font:16px -apple-system;padding:48px">${ok ? '연결됐어요. 이 창을 닫고 앱으로 돌아가세요.' : '연결하지 못했어요. 앱에서 다시 시도해 주세요.'}</body>`);
      if (ok) finish(null, url.searchParams.get('code'));
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
async function connect(server, rec, save, client, openUrl) {
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

const inflight = new Map();

// A valid access token, refreshing it when it is about to expire.
// Returns null when the user has to sign in again; never opens a browser.
function accessToken(server, rec, save, client) {
  if (!rec.tokens?.access_token) return Promise.resolve(null);
  if (!rec.expiresAt || rec.expiresAt - Date.now() > 60_000) return Promise.resolve(rec.tokens.access_token);
  if (!rec.tokens.refresh_token) return Promise.resolve(null);
  if (!inflight.has(server.id)) {
    const p = provider(server, rec, save, client, () => { throw new Error('다시 로그인해야 해요'); });
    inflight.set(server.id, auth(p, { serverUrl: server.url, scope: server.oauth?.scope })
      .then((r) => (r === 'AUTHORIZED' ? rec.tokens.access_token : null))
      .catch(() => null)
      .finally(() => inflight.delete(server.id)));
  }
  return inflight.get(server.id);
}

module.exports = { connect, accessToken, configFor, REDIRECT_URI };
