// Builds the landing page (site/) into _site/ for GitHub Pages.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';

rmSync('_site', { recursive: true, force: true });
await build({ entryPoints: ['site/main.ts'], outfile: '_site/main.js', bundle: true, format: 'esm', target: 'es2022', minify: true });
for (const f of ['index.html', 'styles.css', 'codex.png']) cpSync(`site/${f}`, `_site/${f}`);
// The demo and logo strip use the app's own service logos.
cpSync('src/renderer/logos', '_site/logos', { recursive: true });
// 1024 px is far more than a favicon or nav logo needs; sips ships with macOS, other hosts copy as is.
cpSync('build/icon.png', '_site/icon.png');
try { execFileSync('sips', ['-Z', '256', '_site/icon.png'], { stdio: 'ignore' }); } catch {}
