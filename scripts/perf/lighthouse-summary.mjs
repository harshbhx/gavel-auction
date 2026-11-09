#!/usr/bin/env node
// Prints the scores and the audits that explain them from Lighthouse JSON reports.
// Usage: node scripts/perf/lighthouse-summary.mjs <report.json> [...]
import { readFileSync } from 'node:fs';

const nodeText = (n) => (n ? `${n.selector ?? ''} | ${(n.snippet ?? '').slice(0, 140)}` : '');

for (const file of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const a = r.audits;
  const cat = (id) => Math.round((r.categories[id]?.score ?? 0) * 100);
  console.log(`\n## ${file} (${r.configSettings.formFactor}, Lighthouse ${r.lighthouseVersion})`);
  console.log(
    `Performance ${cat('performance')} | Accessibility ${cat('accessibility')} | Best Practices ${cat('best-practices')} | SEO ${cat('seo')}`,
  );
  for (const id of [
    'first-contentful-paint',
    'largest-contentful-paint',
    'total-blocking-time',
    'cumulative-layout-shift',
    'speed-index',
  ]) {
    console.log(`${id}: ${a[id]?.displayValue ?? a[id]?.errorMessage ?? a[id]?.scoreDisplayMode}`);
  }
  const lcp = a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
  console.log(`LCP element: ${nodeText(lcp) || 'none'}`);
  for (const id of [
    'layout-shifts',
    'layout-shift-elements',
    'non-composited-animations',
    'unsized-images',
    'font-display',
    'render-blocking-resources',
    'render-blocking-insight',
    'unminified-javascript',
    'modern-image-formats',
    'uses-optimized-images',
    'uses-responsive-images',
    'forced-reflow-insight',
    'cls-culprits-insight',
    'image-delivery-insight',
  ]) {
    const x = a[id];
    if (!x) continue;
    console.log(`\n### ${id}: score ${x.score} ${x.displayValue ?? ''}`);
    const items = x.details?.items ?? x.details?.sections ?? [];
    console.log(JSON.stringify(items, null, 1).slice(0, 3500));
  }
  console.log('\n### network (first 40 requests)');
  for (const it of (a['network-requests']?.details?.items ?? []).slice(0, 40)) {
    console.log(`${it.resourceType}\t${it.transferSize}\t${it.url}`);
  }
}
