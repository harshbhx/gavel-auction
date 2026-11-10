// Renders STILLS ONLY of the GAVEL launch film v3 (no video). CI only (.github/workflows/film-v3-stills.yml).
// Usage: node stills.mjs <outDir>   (STILLS_PER_SCENE=5)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.resolve(process.argv[2] ?? 'out/stills');
const N = Number(process.env.STILLS_PER_SCENE || 5);
const FPS = 30;
mkdirSync(OUT, { recursive: true });

const table = JSON.parse(readFileSync(path.join(here, 'src/scenes.json'), 'utf8')).scenes;
const lockup = readFileSync(path.join(root, 'brand/svg/lockup-h-color.svg'), 'utf8');
const letters = [...lockup.matchAll(/<g><g transform="translate\(([\d.]+) 0\)">([\s\S]*?)<\/g><\/g>/g)]
  .map((x) => `<g transform="translate(${x[1]} 0)">${x[2]}</g>`)
  .map((l) => l.replace(/fill="#1d1712"/g, 'fill="currentColor"'));
if (letters.length !== 5) throw new Error('expected 5 wordmark letters');

const PUBLIC = path.join(here, 'public');
rmSync(PUBLIC, { recursive: true, force: true });
mkdirSync(PUBLIC, { recursive: true });
cpSync(path.join(root, 'packages/web/src/design/fonts'), path.join(PUBLIC, 'fonts'), { recursive: true });
cpSync(path.join(root, 'brand/svg'), path.join(PUBLIC, 'brand'), { recursive: true });
if (existsSync(path.join(root, 'brand/partners'))) cpSync(path.join(root, 'brand/partners'), path.join(PUBLIC, 'partners'), { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(here, 'src/index.ts'), publicDir: PUBLIC });
const index = [];
let start = 0;
let sceneNo = 0;
for (const sc of table) {
  sceneNo += 1;
  const inputProps = { fps: FPS, ids: [sc.id], scale: 1, letters, sponsorLogos: false };
  const comp = await selectComposition({ serveUrl, id: 'Film', inputProps });
  for (let i = 0; i < N; i++) {
    const frac = [0.12, 0.3, 0.5, 0.72, 0.93].slice(0, N)[i] ?? (i + 0.5) / N;
    const frame = Math.min(comp.durationInFrames - 1, Math.round(frac * sc.dur * FPS));
    const name = `${String(sceneNo).padStart(2, '0')}-${sc.id}-${i + 1}.jpg`;
    await renderStill({ composition: comp, serveUrl, output: path.join(OUT, name), frame, inputProps, imageFormat: 'jpeg', jpegQuality: 90 });
    index.push({ file: name, scene: sc.id, at: +(start + frame / FPS).toFixed(2), local: +(frame / FPS).toFixed(2) });
    console.log('[stills]', name);
  }
  start += sc.dur;
}
writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
