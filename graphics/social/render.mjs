/* global document */
// Social previews and YouTube assets. Usage: node graphics/social/render.mjs <outDir>
// Everything is drawn from social.html (one template, picked by ?k=) with the brand SVGs in brand/svg.
import { mkdirSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openBrowser, seek } from '../lib/render.mjs';

const outDir = path.resolve(process.argv[2] ?? 'out/social');
const here = path.dirname(fileURLToPath(import.meta.url));
const page_url = (qs) => pathToFileURL(path.join(here, 'social.html')).href + '?' + qs;
mkdirSync(outDir, { recursive: true });

const ALT = {};
const alt = (file, text) => (ALT[file] = text);

const HOOK = 'Bids are holds. The hammer is the charge.';
const cards = [
  [
    'github-social-preview.png',
    1280,
    640,
    'GitHub repository social preview (upload in repo Settings, owner only)',
  ],
  ['x-card-1200x628.png', 1200, 628, 'X (Twitter) summary_large_image card'],
  ['x-card-1200x675.png', 1200, 675, 'X (Twitter) 16:9 card'],
  ['og-1200x630.png', 1200, 630, 'Open Graph image'],
  ['linkedin-1200x627.png', 1200, 627, 'LinkedIn link share image'],
];
const cardAlt =
  'GAVEL card on paper: the Mallet G logo, the headline "Bids are holds. The hammer is the charge." with the hammer line on an orange bar, a five step strip Hold, Bid, Hammer, Receipt, Verify, and the address gavel.dualmindlab.tech. A pill says PayPal sandbox only, no real money.';

async function shot(browser, qs, file, w, h, opts = {}) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: opts.scale ?? 1,
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(page_url(qs));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  if (opts.at !== undefined) await seek(page, opts.at);
  const out = path.join(outDir, file);
  if (opts.tightSel) {
    const box = await (await page.$(opts.tightSel)).boundingBox();
    const pad = 16;
    await page.screenshot({
      path: out,
      omitBackground: true,
      clip: {
        x: Math.max(0, box.x - 2),
        y: Math.max(0, box.y - 2),
        width: box.width + pad,
        height: box.height + pad,
      },
    });
  } else {
    await page.screenshot({ path: out, omitBackground: !!opts.transparent });
  }
  await page.close();
}

const browser = await openBrowser();

for (const [f, w, h] of cards) {
  await shot(browser, 'k=card', f, w, h);
  alt(f, cardAlt);
}

await shot(browser, 'k=thumbA', 'youtube-thumbnail-A.png', 1280, 720);
alt(
  'youtube-thumbnail-A.png',
  'YouTube thumbnail A: huge ink headline "Bids are holds." then "The hammer is the charge." on an orange bar, the Mallet G plate at right, GAVEL logo and a PayPal sandbox tag at top.',
);
await shot(browser, 'k=thumbB', 'youtube-thumbnail-B.png', 1280, 720);
alt(
  'youtube-thumbnail-B.png',
  'YouTube thumbnail B on dark ink: "Nobody pays until the hammer." with the last word in signal orange, the Mallet G plate at right, GAVEL logo and a PayPal sandbox tag.',
);

await shot(browser, 'k=end', 'youtube-end-card-1920x1080.png', 1920, 1080);
alt(
  'youtube-end-card-1920x1080.png',
  'YouTube end card: GAVEL logo, "Hold the bid. Hammer the charge.", empty dashed zones for a subscribe circle and two 16:9 video end elements, and the web and repo addresses.',
);
await shot(browser, 'k=end&guides=1', 'youtube-end-card-guides.png', 1920, 1080);
alt(
  'youtube-end-card-guides.png',
  'The end card with the reserved zones labelled, for planning only. Do not upload this one.',
);

const lowers = [
  ['lower-third-hook', 'GAVEL', HOOK],
  ['lower-third-sandbox', 'PayPal sandbox', 'No real money moves in this demo'],
];
for (const [name, t, s] of lowers) {
  const qs = 'k=lower&t=' + encodeURIComponent(t) + '&s=' + encodeURIComponent(s);
  await shot(browser, qs, `${name}.png`, 1920, 1080, { transparent: true, at: 1500 });
  alt(
    `${name}.png`,
    `Transparent 1920x1080 lower third: ink bar with orange edge, the Mallet G mark, title "${t}" and subtitle "${s}", bottom left.`,
  );
  // animated alpha WebM: 3 s at 30 fps, slide in, hold, slide out
  const fdir = path.join(outDir, '_frames_' + name);
  rmSync(fdir, { recursive: true, force: true });
  mkdirSync(fdir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(page_url(qs));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  for (let i = 0; i < 90; i++) {
    await seek(page, (i / 30) * 1000);
    await page.screenshot({
      path: path.join(fdir, `f${String(i).padStart(4, '0')}.png`),
      omitBackground: true,
    });
  }
  await page.close();
  const webm = path.join(outDir, `${name}-alpha.webm`);
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    '30',
    '-i',
    path.join(fdir, 'f%04d.png'),
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-b:v',
    '0',
    '-crf',
    '30',
    '-auto-alt-ref',
    '0',
    '-an',
    webm,
  ]);
  rmSync(fdir, { recursive: true, force: true });
  alt(
    `${name}-alpha.webm`,
    `Animated alpha version of the lower third: slides in from the left, holds, slides out, 3 seconds, VP9 with alpha.`,
  );
  console.log(
    name,
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name,pix_fmt:stream_tags=alpha_mode:format=duration',
      '-of',
      'default=nw=1',
      webm,
    ])
      .toString()
      .replace(/\n/g, ' '),
  );
}

await shot(browser, 'k=bug', 'bug-sandbox-only-1920x1080.png', 1920, 1080, { transparent: true });
alt(
  'bug-sandbox-only-1920x1080.png',
  'Transparent full frame with a small top left bug reading "Sandbox only, no real money".',
);
await shot(browser, 'k=bug', 'bug-sandbox-only-tight.png', 900, 200, { scale: 2, tightSel: '.ov' });
alt('bug-sandbox-only-tight.png', 'Cropped bug "Sandbox only, no real money" on transparent, 2x.');
await shot(browser, 'k=sim', 'chip-simulated.png', 600, 200, { scale: 2, tightSel: '.ov' });
alt(
  'chip-simulated.png',
  'Orange label chip reading "Simulated", transparent, 2x. Put it on any scripted or fake-PayPal footage.',
);
await shot(browser, 'k=rec', 'chip-recorded.png', 600, 200, { scale: 2, tightSel: '.ov' });
alt(
  'chip-recorded.png',
  'Paper label chip reading "Recorded" with a red dot, transparent, 2x. Put it on footage of a real sandbox session.',
);
await shot(browser, 'k=sim', 'chip-simulated-1920x1080.png', 1920, 1080, { transparent: true });
alt(
  'chip-simulated-1920x1080.png',
  'Transparent full frame with the "Simulated" chip at top left.',
);
await shot(browser, 'k=rec', 'chip-recorded-1920x1080.png', 1920, 1080, { transparent: true });
alt('chip-recorded-1920x1080.png', 'Transparent full frame with the "Recorded" chip at top left.');

await browser.close();

// manifest with alt text and sizes
const files = readdirSync(outDir)
  .filter((f) => !f.startsWith('_') && f !== 'manifest.json')
  .sort();
const manifest = files.map((f) => {
  const dims = f.endsWith('.png')
    ? execFileSync('identify', ['-format', '%wx%h', f], { cwd: outDir }).toString()
    : '1920x1080';
  return { file: f, bytes: statSync(path.join(outDir, f)).size, size: dims, alt: ALT[f] ?? '' };
});
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const m of manifest) console.log(m.bytes, m.size, m.file);
