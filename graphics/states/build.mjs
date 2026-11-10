#!/usr/bin/env node
// Turns the raw screen-tour PNGs into the brand kit states library (GFX-13).
// Usage: node graphics/states/build.mjs <rawDir> <outDir> [docsDir]
//   rawDir   folder of <view>--<state>--<project>.png from the screen tour (desktop-light, phone-light)
//   docsDir  optional folder of docs-<page>--<viewport>.png from graphics/states/docs.mjs
//   outDir   receives <area>/NN-<screen>-<state>-<desktop|phone>.png, devpost/, contact/, manifest.json, README.md
// Needs sharp (TOOLS_DIR points at the folder it was installed in). Runs in CI only.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { CATALOG, DEVPOST, DROP, STATE_NOTES } from './catalog.mjs';

const require = createRequire(`${resolve(process.env.TOOLS_DIR ?? '.')}/`);
const sharp = require('sharp');

const [rawArg, outArg, docsArg] = process.argv.slice(2);
if (rawArg === undefined || outArg === undefined) {
  process.stderr.write('usage: build.mjs <rawDir> <outDir> [docsDir]\n');
  process.exit(2);
}
const rawDir = resolve(rawArg);
const outDir = resolve(outArg);
const RAW_BASE = 'https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/screens';
const VIEWPORTS = {
  'desktop-light': { key: 'desktop', text: '1440x900' },
  'phone-light': { key: 'phone', text: '390x844' },
};
const MAX_BYTES = 400 * 1024;

/** Splits <view>--<state>--<project>.png. Docs files use docs-<page>--<project>.png. */
function parse(file) {
  const m = /^(.+?)--(.+)--([a-z]+-[a-z]+)\.png$/.exec(file);
  if (m !== null) return { view: m[1], state: m[2], project: m[3], file };
  const d = /^docs-(.+)--([a-z]+-[a-z]+)\.png$/.exec(file);
  return d === null ? null : { view: 'docs', state: d[1], project: d[2], file };
}

const sources = [];
for (const [dir, label] of [
  [rawDir, 'tour'],
  [docsArg === undefined ? null : resolve(docsArg), 'docs'],
]) {
  if (dir === null) continue;
  for (const f of readdirSync(dir)) {
    const e = parse(f);
    if (e !== null && VIEWPORTS[e.project] !== undefined) sources.push({ ...e, dir, from: label });
  }
}

const catalogOf = (view) =>
  CATALOG[view] ?? { order: 99, area: 'misc', screen: view, route: '(component page)' };
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Palette PNG through libimagequant, smallest effort first, then a lighter palette if still large. */
async function optimise(buffer) {
  for (const colours of [256, 128, 64]) {
    const out = await sharp(buffer)
      .png({ palette: true, quality: 85, colours, effort: 10, compressionLevel: 9 })
      .toBuffer();
    if (out.length <= MAX_BYTES || colours === 64) return out;
  }
  throw new Error('unreachable');
}

sources.sort(
  (a, b) =>
    catalogOf(a.view).order - catalogOf(b.view).order ||
    a.view.localeCompare(b.view) ||
    a.state.localeCompare(b.state) ||
    a.project.localeCompare(b.project),
);

const entries = [];
const dropped = [];
const seen = new Map(); // view + viewport + pixel hash -> file already kept
for (const s of sources) {
  const cat = catalogOf(s.view);
  const manual = DROP.find(([k]) => `${s.view}/${s.state}`.startsWith(k));
  if (manual !== undefined) {
    dropped.push({ file: s.file, reason: manual[1] });
    continue;
  }
  const vp = VIEWPORTS[s.project];
  const src = readFileSync(join(s.dir, s.file));
  if (src.length < 4000) {
    dropped.push({ file: s.file, reason: 'blank or failed capture (under 4 KB)' });
    continue;
  }
  const hash = createHash('sha1')
    .update(await sharp(src).raw().toBuffer())
    .digest('hex');
  const dupKey = `${s.view}|${vp.key}|${hash}`;
  if (seen.has(dupKey)) {
    dropped.push({ file: s.file, reason: `identical pixels to ${seen.get(dupKey)}` });
    continue;
  }
  const name = `${String(cat.order).padStart(2, '0')}-${slug(s.view)}-${slug(s.state)}-${vp.key}.png`;
  seen.set(dupKey, name);
  const buf = await optimise(src);
  mkdirSync(join(outDir, cat.area), { recursive: true });
  writeFileSync(join(outDir, cat.area, name), buf);
  const m2 = await sharp(buf).metadata();
  entries.push({
    file: `${cat.area}/${name}`,
    area: cat.area,
    order: cat.order,
    screen: cat.screen,
    view: s.view,
    state: s.state,
    note: STATE_NOTES[`${s.view}/${s.state}`] ?? s.state.replace(/-/g, ' '),
    route: cat.route,
    viewport: vp.key,
    viewportSize: vp.text,
    pixels: `${m2.width}x${m2.height}`,
    sourceScale: m2.width > 1440 ? 2 : 1,
    bytes: buf.length,
    overBudget: buf.length > MAX_BYTES,
    sandbox: cat.sandbox === true,
    rawUrl: `${RAW_BASE}/${cat.area}/${name}`,
    from: s.from,
  });
}

// Devpost 3:2 crops of the best desktop states (top of the page, 1500x1000).
mkdirSync(join(outDir, 'devpost'), { recursive: true });
const devpost = [];
for (const [i, d] of DEVPOST.entries()) {
  const hit = entries.find(
    (e) => e.view === d.view && e.state === d.state && e.viewport === 'desktop',
  );
  if (hit === undefined) {
    dropped.push({ file: `devpost ${d.view}/${d.state}`, reason: 'source state not captured' });
    continue;
  }
  const full = await sharp(
    readFileSync(join(rawDir, `${hit.view}--${hit.state}--desktop-light.png`)),
  ).metadata();
  const w = full.width ?? 1440;
  const h = full.height ?? 900;
  const cropH = Math.min(h, Math.round((w * 2) / 3));
  const cropW = Math.round((cropH * 3) / 2);
  const name = `${String(i + 1).padStart(2, '0')}-${d.name}-3x2.png`;
  const buf = await sharp(
    readFileSync(join(rawDir, `${hit.view}--${hit.state}--desktop-light.png`)),
  )
    .extract({
      left: Math.max(0, Math.round((w - cropW) / 2)),
      top: 0,
      width: Math.min(cropW, w),
      height: cropH,
    })
    .resize(1500, 1000)
    .png({ palette: true, quality: 90, colours: 256, effort: 10, compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(outDir, 'devpost', name), buf);
  devpost.push({
    file: `devpost/${name}`,
    from: hit.file,
    caption: d.caption,
    size: '1500x1000',
    bytes: buf.length,
    rawUrl: `${RAW_BASE}/devpost/${name}`,
  });
}

// Contact sheets, one per area, for reviewing the run (not committed).
mkdirSync(join(outDir, 'contact'), { recursive: true });
const areas = [...new Set(entries.map((e) => e.area))];
for (const area of areas) {
  for (const vp of ['desktop', 'phone']) {
    const list = entries.filter((e) => e.area === area && e.viewport === vp);
    if (list.length === 0) continue;
    const cols = vp === 'desktop' ? 4 : 8;
    const tw = vp === 'desktop' ? 360 : 170;
    const th = vp === 'desktop' ? 225 : 360;
    const rowsN = Math.ceil(list.length / cols);
    const labelH = 28;
    const comps = [];
    for (const [i, e] of list.entries()) {
      const x = (i % cols) * (tw + 8) + 8;
      const y = Math.floor(i / cols) * (th + labelH + 8) + 8;
      const thumb = await sharp(join(outDir, e.file))
        .resize(tw, th, { fit: 'cover', position: 'top' })
        .toBuffer();
      comps.push({ input: thumb, left: x, top: y });
      const label = `${e.view}/${e.state}`
        .slice(0, vp === 'desktop' ? 52 : 24)
        .replace(/&/g, '&amp;');
      comps.push({
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${labelH}"><text x="0" y="18" font-family="DejaVu Sans, sans-serif" font-size="11" fill="#222">${label}</text></svg>`,
        ),
        left: x,
        top: y + th + 2,
      });
    }
    await sharp({
      create: {
        width: cols * (tw + 8) + 8,
        height: rowsN * (th + labelH + 8) + 8,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .composite(comps)
      .png()
      .toFile(join(outDir, 'contact', `${area}-${vp}.png`));
  }
}

writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify(
    {
      count: entries.length,
      areas,
      generatedBy: 'graphics/states/build.mjs',
      viewports: { desktop: '1440x900 CSS px, light', phone: '390x844 CSS px, light, saved at 2x' },
      entries,
      devpost,
      dropped,
    },
    null,
    2,
  ),
);

// README index.
const kb = (n) => `${Math.round(n / 1024)} KB`;
let md = '# UI states library\n\n';
md += `${entries.length} images across ${areas.length} areas, light theme only. Desktop is 1440x900 CSS px; phone is 390x844 CSS px saved at 2x (780 px wide). `;
md +=
  'Every room, hold and receipt shown is the **sandbox**: simulated holds from a scripted local stack, no real PayPal popup and no real money. ';
md +=
  'Captured in GitHub Actions with reduced motion, a frozen clock and the app fonts; see [`graphics/states/`](../../graphics/states/README.md) to reproduce. ';
md +=
  'The journey in order is in [`FLOWS.md`](FLOWS.md); Devpost 3:2 crops are in [`devpost/`](devpost).\n\n';
md +=
  "File names are `NN-<screen>-<state>-<desktop|phone>.png`; `NN` is the screen's place in the judge journey. The raw URL column is the permanent `main` link.\n\n";
for (const area of areas) {
  const list = entries.filter((e) => e.area === area);
  md += `## ${area}\n\n`;
  md +=
    '| Image | Size | State | Screen | Route | Viewport | Raw main URL |\n|---|---|---|---|---|---|---|\n';
  for (const e of list) {
    const tag = e.sandbox ? ' (sandbox)' : '';
    md += `| [${e.file.split('/')[1]}](${e.file}) | ${e.pixels}, ${kb(e.bytes)} | ${e.note}${tag} | ${e.screen} | \`${e.route}\` | ${e.viewportSize} ${e.viewport} | ${e.rawUrl} |\n`;
  }
  md += '\n';
}
md +=
  '## devpost\n\n3:2 crops (1500x1000) of the eight strongest desktop states.\n\n| Image | Size | Caption | Raw main URL |\n|---|---|---|---|\n';
for (const d of devpost)
  md += `| [${d.file.split('/')[1]}](${d.file}) | ${d.size}, ${kb(d.bytes)} | ${d.caption} | ${d.rawUrl} |\n`;
md += '\n';
if (dropped.length > 0) {
  md +=
    '## Not included\n\nCaptured but dropped (blank, or pixel-identical to another state of the same screen):\n\n';
  for (const d of dropped) md += `- \`${d.file}\`: ${d.reason}\n`;
  md += '\n';
}
md += '## States that cannot be drawn\n\n';
md +=
  '- A real PayPal approval popup: the hosted page is not ours; every hold here is a simulated sandbox hold.\n';
md +=
  '- Muted and outage banners on the bidder and console screens: the app has none (see `packages/web/test/screens/README.md`).\n';
writeFileSync(join(outDir, 'README.md'), md);

const over = entries.filter((e) => e.overBudget).length;
process.stdout.write(
  `built ${entries.length} images, ${devpost.length} devpost crops, ${dropped.length} dropped, ${over} over ${kb(MAX_BYTES)}\n`,
);
