// Builds the landing page (site/) into _site/ for GitHub Pages.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('_site', { recursive: true, force: true });
await build({ entryPoints: ['site/main.ts'], outfile: '_site/main.js', bundle: true, format: 'esm', target: 'es2022', minify: true });
for (const f of ['index.html', 'styles.css', 'codex.png', 'install.sh']) cpSync(`site/${f}`, `_site/${f}`);
// Asset URLs change with every build, so browsers never pair new HTML with an old cached script or stylesheet.
const v = Date.now().toString(36);
writeFileSync('_site/index.html', readFileSync('_site/index.html', 'utf8').replace('href="styles.css"', `href="styles.css?v=${v}"`).replace('src="main.js"', `src="main.js?v=${v}"`));
// The demo and logo strip use the app's own service logos.
cpSync('src/renderer/logos', '_site/logos', { recursive: true });
// 1024 px is far more than a favicon or nav logo needs; sips ships with macOS, other hosts copy as is.
cpSync('build/icon.png', '_site/icon.png');
try { execFileSync('sips', ['-Z', '256', '_site/icon.png'], { stdio: 'ignore' }); } catch {}
