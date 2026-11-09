#!/usr/bin/env node
// Accessibility gate for the docs site: axe-core over the home page, one docs page, the glossary
// and the API reference (the OpenAPI page), at desktop and phone width. Fails on serious and
// critical violations; moderate and minor ones are listed in the report only.
// Usage: node scripts/a11y.mjs <base-url> <report-dir>
// Needs playwright and axe-core (installed with --no-save by the workflow). Not run on the VM.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const base = process.argv[2] ?? 'http://localhost:4173';
const outDir = process.argv[3] ?? 'a11y';
mkdirSync(outDir, { recursive: true });

const pages = [
  ['home', '/'],
  ['docs-page', '/docs/start'],
  ['glossary', '/docs/reference/glossary'],
  ['openapi', '/docs/reference/api-reference'],
];
const viewports = [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
];

const browser = await chromium.launch();
const report = [];
let failures = 0;

for (const [vname, viewport] of viewports) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  for (const [name, url] of pages) {
    const page = await context.newPage();
    const res = await page.goto(base + url, { waitUntil: 'networkidle' });
    if (!res || !res.ok()) {
      console.error(`FAIL ${url}: HTTP ${res?.status()}`);
      failures += 1;
    }
    // Mermaid and the glossary hydrate after load.
    await page.waitForTimeout(1200);
    await page.evaluate(axeSource);
    const result = await page.evaluate(() =>
      // eslint-disable-next-line no-undef
      axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }),
    );
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    report.push({
      page: url,
      viewport: vname,
      violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 10) })),
    });
    console.log(`${vname} ${url}: ${result.violations.length} violation(s), ${bad.length} serious or critical`);
    for (const v of bad) {
      console.error(`FAIL ${vname} ${url}: ${v.id} (${v.impact}) ${v.help}`);
      for (const n of v.nodes.slice(0, 5)) console.error(`    ${n.target.join(' ')}`);
      failures += 1;
    }
    await page.close();
  }
  await context.close();
}

await browser.close();
writeFileSync(join(outDir, 'axe-report.json'), JSON.stringify(report, null, 2));
if (failures > 0) {
  console.error(`${failures} problem(s)`);
  process.exit(1);
}
