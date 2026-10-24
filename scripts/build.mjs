// Bundles main, preload and renderer into out/. Type checking is `npm run typecheck`.
import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('out', { recursive: true, force: true });

const node = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external', sourcemap: true, external: ['electron'] };
await Promise.all([
  build({ ...node, entryPoints: ['src/main/main.ts'], outfile: 'out/main.cjs' }),
  build({ ...node, entryPoints: ['src/preload/preload.ts'], outfile: 'out/preload.cjs' }),
  build({
    entryPoints: ['src/renderer/app.ts'],
    outdir: 'out/renderer',
    bundle: true,
    format: 'esm',
    splitting: true,
    platform: 'browser',
    target: 'chrome140',
    sourcemap: true,
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  }),
]);
for (const f of ['index.html', 'styles.css', 'logos']) cpSync(`src/renderer/${f}`, `out/renderer/${f}`, { recursive: true });
cpSync('src/main/stt.swift', 'out/stt.swift');
