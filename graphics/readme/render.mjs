// README graphics set. Usage: node graphics/readme/render.mjs <outDir> (run in CI by graphics.yml).
import { mkdirSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { openBrowser, still, frames, gif } from '../lib/render.mjs';
import {
  LIGHT,
  DARK,
  hero,
  architecture,
  lifecycle,
  outro,
  html,
  HERO_END,
  ARCH_END,
  OUTRO_END,
} from './svg.mjs';

const out = path.resolve(process.argv[2] ?? 'out/readme');
const tmp = path.join(out, '.tmp');
mkdirSync(tmp, { recursive: true });

const dims = (svg) =>
  svg
    .match(/width="(\d+)" height="(\d+)"/)
    .slice(1)
    .map(Number);
const write = (name, data) => writeFileSync(path.join(out, name), data);
const htmlFile = (name, svg, th) => {
  const f = path.join(tmp, `${name}.html`);
  writeFileSync(f, html(svg, th.bg));
  return f;
};

const browser = await openBrowser();
try {
  // Static SVG plus 2x PNG, light and dark.
  const statics = {
    hero: (t) => hero(t, false),
    architecture: (t) => architecture(t, false),
    lifecycle: (t) => lifecycle(t),
  };
  for (const [name, fn] of Object.entries(statics)) {
    for (const th of [LIGHT, DARK]) {
      const svg = fn(th);
      write(`${name}-${th.name}.svg`, svg);
      const [w, h] = dims(svg);
      await still(
        browser,
        htmlFile(`${name}-${th.name}`, svg, th),
        path.join(out, `${name}-${th.name}.png`),
        w,
        h,
        { scale: 2 },
      );
    }
  }
  // Outro static fallback (light) as PNG and SVG.
  {
    const svg = outro(LIGHT, false);
    write('outro-light.svg', svg);
    const [w, h] = dims(svg);
    await still(browser, htmlFile('outro-static', svg, LIGHT), path.join(out, 'outro.png'), w, h, {
      scale: 2,
    });
  }

  // Animated GIFs (light, on paper), sampled by seeking.
  const anim = [
    { name: 'hero', svg: hero(LIGHT, true), secs: HERO_END, fps: 15, colors: 96, lossy: 60 },
    {
      name: 'architecture-flow',
      svg: architecture(LIGHT, true),
      secs: ARCH_END,
      fps: 10,
      colors: 64,
      lossy: 60,
    },
    { name: 'outro', svg: outro(LIGHT, true), secs: OUTRO_END, fps: 15, colors: 64, lossy: 60 },
  ];
  const report = [];
  for (const a of anim) {
    const [w, h] = dims(a.svg);
    const f = htmlFile(`${a.name}-anim`, a.svg, LIGHT);
    const dir = path.join(tmp, `${a.name}-frames`);
    await frames(browser, f, dir, w, h, a.fps, a.secs);
    const size = gif(dir, path.join(out, `${a.name}.gif`), {
      fps: a.fps,
      width: 1280,
      colors: a.colors,
      lossy: a.lossy,
    });
    report.push(`${a.name}.gif ${size}`);
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(report.join('\n'));
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
for (const f of readdirSync(out)) console.log(f, statSync(path.join(out, f)).size);
