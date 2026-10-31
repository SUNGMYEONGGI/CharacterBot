// "Is there a newer PixelBot?" Reads the latest GitHub release; nothing is
// downloaded or installed (the build is unsigned, so the user installs by hand).

export const RELEASES = 'https://api.github.com/repos/SUNGMYEONGGI/PixelBot/releases/latest';

const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);

// True when `latest` is a higher major.minor.patch than `current`.
export function newer(latest: string, current: string): boolean {
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export interface AppUpdate {
  version: string;
  url: string;
}

// The newer release, or null when up to date. Throws on network/HTTP errors.
export async function check(current: string, get: typeof fetch = fetch): Promise<AppUpdate | null> {
  const res = await get(RELEASES, { headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`업데이트 확인 실패 (${res.status})`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  // Only ever link to this repo's release pages.
  const url = /^https:\/\/github\.com\/SUNGMYEONGGI\/PixelBot\/releases\//.test(rel.html_url) ? rel.html_url : 'https://github.com/SUNGMYEONGGI/PixelBot/releases/latest';
  return version && newer(version, current) ? { version, url } : null;
}
