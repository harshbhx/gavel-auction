import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(path.join(process.env.PW_DIR, 'x.js'));
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const names = { a: 'gavel-thumbnail-v7a-hold-1280x720', b: 'gavel-thumbnail-v7b-hammer-1280x720', c: 'gavel-thumbnail-v7c-outbid-1280x720' };
const n32 = { a32: 'gavel-devpost-thumb-a-1500x1000', b32: 'gavel-devpost-thumb-b-1500x1000', c32: 'gavel-devpost-thumb-c-1500x1000' };
const b = await chromium.launch({ channel: 'chrome' });
for (const [k, n] of Object.entries(names)) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(pathToFileURL(path.join(here, k + '.html')).href);
  await p.waitForSelector('body[data-ready="1"]');
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(out, n + '.png') });
}
for (const [k, n] of Object.entries(n32)) {
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await p.goto(pathToFileURL(path.join(here, k + '.html')).href);
  await p.waitForSelector('body[data-ready="1"]');
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(out, n + '.png') });
}
await b.close();
