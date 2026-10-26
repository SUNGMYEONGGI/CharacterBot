// v0.2.0 renamed CharacterBot to PixelBot. These move a v0.1.x install over once.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const LEGACY_NAME = 'CharacterBot';

// Claude Code keeps sessions under ~/.claude/projects/<cwd with every
// non-alphanumeric character turned into "-">.
const projectKey = (dir: string): string => dir.replace(/[^a-zA-Z0-9]/g, '-');

// Moves `from` to `to` when `to` has no state.json yet, rewrites the absolute paths in
// state.json and moves the bots' Claude sessions so conversations resume.
// Returns true when it moved something.
export function moveDataDir(from: string, to: string, claudeProjects = path.join(os.homedir(), '.claude', 'projects')): boolean {
  if (fs.existsSync(path.join(to, 'state.json')) || !fs.existsSync(from)) return false;
  // Chromium can create the new folder (caches only) before this runs.
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
  const stateFile = path.join(to, 'state.json');
  if (fs.existsSync(stateFile)) {
    const esc = (p: string) => JSON.stringify(p).slice(1, -1);
    fs.writeFileSync(stateFile, fs.readFileSync(stateFile, 'utf8').split(esc(from) + esc(path.sep)).join(esc(to) + esc(path.sep)));
  }
  const oldKey = `${projectKey(from)}-workspaces-`;
  const newKey = `${projectKey(to)}-workspaces-`;
  try {
    for (const name of fs.readdirSync(claudeProjects)) {
      const dest = path.join(claudeProjects, newKey + name.slice(oldKey.length));
      if (name.startsWith(oldKey) && !fs.existsSync(dest)) fs.renameSync(path.join(claudeProjects, name), dest);
    }
  } catch {}
  return true;
}

// Decrypts a safeStorage blob written under the old app name. On macOS the key
// is the "<name> Safe Storage" Keychain password (Chromium's v10 format:
// AES-128-CBC, PBKDF2-SHA1 with salt "saltysalt", 1003 rounds, IV of spaces).
export function decryptLegacy(blob: Buffer, password: string | null): string | null {
  if (!password || blob.subarray(0, 3).toString() !== 'v10') return null;
  try {
    const key = crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
    return Buffer.concat([d.update(blob.subarray(3)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// Reads the old Keychain password without blocking the app; macOS asks the user
// once to let PixelBot read the CharacterBot item.
export function legacyPassword(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-w', '-s', `${LEGACY_NAME} Safe Storage`], { timeout: 120000 }, (err, out) => resolve(err ? null : String(out).trim()));
  });
}
