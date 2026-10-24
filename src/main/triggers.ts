// Event triggers for routines: a local webhook, a watched folder, or a GitHub
// repo's pull requests (polled read-only through the gh CLI).
// fire(routine, eventText) runs the routine with what happened.
import fs from 'node:fs';
import http from 'node:http';
import { execFile } from 'node:child_process';
import type { Routine, Schedule } from '../shared/types';

type Fire = (routine: Routine, event: string) => void;
interface Watch {
  path: string;
  files: Set<string>;
  timer: NodeJS.Timeout | undefined;
  watcher?: fs.FSWatcher;
  error?: string;
}
interface GithubPoll {
  repo: string;
  seen: Map<number, string> | null;
  last: number;
}
interface Pr {
  number: number;
  title: string;
  updatedAt: string;
  url: string;
  author?: { login?: string };
}
const isEvent = (s: Schedule): boolean => s.type === 'webhook' || s.type === 'file' || s.type === 'github';

const PORT = 47819; // webhooks: POST http://127.0.0.1:47819/hook/<key>
const DEBOUNCE_MS = 5000;
const GITHUB_POLL_MS = 5 * 60_000;

let server: http.Server | null = null;
let byKey = new Map<string, Routine>(); // webhook key -> routine
const watchers = new Map<string, Watch>(); // routine id -> watched folder
const github = new Map<string, GithubPoll>(); // routine id -> PR snapshot

const webhookUrl = (key: string): string => `http://127.0.0.1:${PORT}/hook/${key}`;

function startServer(fire: Fire) {
  server = http.createServer((req, res) => {
    const key = req.url?.match(/^\/hook\/([\w-]+)$/)?.[1];
    const routine = req.method === 'POST' && key ? byKey.get(key) : undefined;
    if (!routine) return void res.writeHead(404).end();
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

function watchFolder(routine: Routine, path: string, fire: Fire): Watch {
  const entry: Watch = { path, files: new Set(), timer: undefined };
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
    entry.error = (err as Error).message;
  }
  return entry;
}

const ghPrs = (repo: string) => new Promise<Pr[]>((resolve, reject) => {
  execFile('gh', ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '50', '--json', 'number,title,updatedAt,url,author'], { timeout: 30_000 }, (err, out) => {
    if (err) reject(err); else resolve(JSON.parse(out));
  });
});

async function pollGithub(routine: Routine, entry: GithubPoll, fire: Fire) {
  entry.last = Date.now();
  const prs = await ghPrs(entry.repo).catch(() => null);
  if (!prs) return;
  const seen = entry.seen;
  const changed = seen ? prs.filter((p) => seen.get(p.number) !== p.updatedAt) : [];
  entry.seen = new Map(prs.map((p) => [p.number, p.updatedAt])); // first poll only records a baseline
  if (changed.length) fire(routine, `${entry.repo}의 새로 열리거나 업데이트된 PR ${changed.length}개:\n${changed.map((p) => `- #${p.number} ${p.title} (${p.author?.login || ''}) ${p.url}`).join('\n')}`);
}

// Brings servers and watchers in line with the enabled event routines.
function sync(routines: Routine[], fire: Fire): void {
  const live = routines.filter((r) => r.enabled && isEvent(r.schedule));
  byKey = new Map();
  for (const r of live) if (r.schedule.type === 'webhook') byKey.set(r.schedule.key, r);
  if (byKey.size && !server) startServer(fire);
  for (const [id, w] of watchers) {
    if (!live.some((r) => r.id === id && r.schedule.type === 'file' && r.schedule.path === w.path)) { w.watcher?.close(); clearTimeout(w.timer); watchers.delete(id); }
  }
  for (const r of live) if (r.schedule.type === 'file' && !watchers.has(r.id)) watchers.set(r.id, watchFolder(r, r.schedule.path, fire));
  for (const id of github.keys()) if (!live.some((r) => r.id === id)) github.delete(id);
  for (const r of live) {
    if (r.schedule.type !== 'github') continue;
    let entry = github.get(r.id);
    if (!entry) github.set(r.id, (entry = { repo: r.schedule.repo, seen: null, last: 0 }));
    if (Date.now() - entry.last >= GITHUB_POLL_MS) pollGithub(r, entry, fire);
  }
}

const status = (routine: Routine): string | null => (routine.schedule.type === 'file' ? watchers.get(routine.id)?.error ?? null : routine.schedule.type === 'webhook' && !server ? '웹훅 서버를 열 수 없어요' : null);

export { sync, webhookUrl, status, PORT };
