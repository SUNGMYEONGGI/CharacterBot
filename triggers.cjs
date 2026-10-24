// Event triggers for routines: a local webhook, a watched folder, or a GitHub
// repo's pull requests (polled read-only through the gh CLI).
// fire(routine, eventText) runs the routine with what happened.
const fs = require('node:fs');
const http = require('node:http');
const { execFile } = require('node:child_process');

const PORT = 47819; // webhooks: POST http://127.0.0.1:47819/hook/<key>
const DEBOUNCE_MS = 5000;
const GITHUB_POLL_MS = 5 * 60_000;

let server = null;
let byKey = new Map(); // webhook key -> routine
const watchers = new Map(); // routine id -> { path, watcher, timer, files }
const github = new Map(); // routine id -> { repo, seen: Map(number -> updatedAt), last }

const webhookUrl = (key) => `http://127.0.0.1:${PORT}/hook/${key}`;

function startServer(fire) {
  server = http.createServer((req, res) => {
    const routine = req.method === 'POST' && byKey.get((req.url.match(/^\/hook\/([\w-]+)$/) || [])[1]);
    if (!routine) return res.writeHead(404).end();
    let body = '';
    req.on('data', (chunk) => { if (body.length < 64_000) body += chunk; });
    req.on('end', () => {
      res.writeHead(202).end('ok');
      fire(routine, `웹훅 요청 (${req.headers['content-type'] || 'text'}):\n${body.slice(0, 8000) || '(본문 없음)'}`);
    });
  });
  server.on('error', () => { server = null; }); // port taken: webhooks just stay off
  server.listen(PORT, '127.0.0.1');
}

function watchFolder(routine, fire) {
  const entry = { path: routine.schedule.path, files: new Set(), timer: null };
  try {
    entry.watcher = fs.watch(entry.path, { recursive: true }, (_type, file) => {
      if (!file || file.split('/').some((p) => p.startsWith('.'))) return;
      entry.files.add(file);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        const files = [...entry.files];
        entry.files.clear();
        fire(routine, `폴더 ${entry.path}에서 바뀐 파일 ${files.length}개:\n${files.slice(0, 50).map((f) => `- ${f}`).join('\n')}`);
      }, DEBOUNCE_MS);
    });
  } catch (err) {
    entry.error = err.message;
  }
  return entry;
}

const ghPrs = (repo) => new Promise((resolve, reject) => {
  execFile('gh', ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '50', '--json', 'number,title,updatedAt,url,author'], { timeout: 30_000 }, (err, out) => {
    if (err) reject(err); else resolve(JSON.parse(out));
  });
});

async function pollGithub(routine, entry, fire) {
  entry.last = Date.now();
  const prs = await ghPrs(entry.repo).catch(() => null);
  if (!prs) return;
  const changed = entry.seen ? prs.filter((p) => entry.seen.get(p.number) !== p.updatedAt) : [];
  entry.seen = new Map(prs.map((p) => [p.number, p.updatedAt])); // first poll only records a baseline
  if (changed.length) fire(routine, `${entry.repo}의 새로 열리거나 업데이트된 PR ${changed.length}개:\n${changed.map((p) => `- #${p.number} ${p.title} (${p.author?.login || ''}) ${p.url}`).join('\n')}`);
}

// Brings servers and watchers in line with the enabled event routines.
function sync(routines, fire) {
  const live = routines.filter((r) => r.enabled && ['webhook', 'file', 'github'].includes(r.schedule.type));
  byKey = new Map(live.filter((r) => r.schedule.type === 'webhook').map((r) => [r.schedule.key, r]));
  if (byKey.size && !server) startServer(fire);
  for (const [id, w] of watchers) {
    if (!live.some((r) => r.id === id && r.schedule.path === w.path)) { w.watcher?.close(); clearTimeout(w.timer); watchers.delete(id); }
  }
  for (const r of live.filter((x) => x.schedule.type === 'file')) if (!watchers.has(r.id)) watchers.set(r.id, watchFolder(r, fire));
  for (const id of github.keys()) if (!live.some((r) => r.id === id)) github.delete(id);
  for (const r of live.filter((x) => x.schedule.type === 'github')) {
    if (!github.has(r.id)) github.set(r.id, { repo: r.schedule.repo, seen: null, last: 0 });
    const entry = github.get(r.id);
    if (Date.now() - entry.last >= GITHUB_POLL_MS) pollGithub(r, entry, fire);
  }
}

const status = (routine) => (routine.schedule.type === 'file' ? watchers.get(routine.id)?.error : routine.schedule.type === 'webhook' && !server ? '웹훅 서버를 열 수 없어요' : null);

module.exports = { sync, webhookUrl, status, PORT };
