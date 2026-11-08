// Builds INDEX.md, index.html and manifest.json for the screenshots in a folder.
// Usage: node test/screens/build-index.mjs [folder]   (default: ui-screens-out)
// A file is named <view>--<state>--<project>.png; the project says viewport and theme.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROJECTS = [
  ['desktop-light', 'Desktop 1440x900, light'],
  ['fhd-light', 'Wide 1920x1080, light'],
  ['hd-light', 'Laptop 1280x720, light'],
  ['phone-light', 'Phone 390x844, light'],
  ['desktop-dark', 'Desktop 1440x900, dark'],
  ['desktop-projector', 'Desktop 1440x900, projector'],
  ['phone-small', 'Small phone 320x640, light (key views)'],
  ['tablet', 'Tablet 768x1024, light (key views)'],
  ['phone-dark', 'Phone 390x844, dark (key views)'],
  ['phone-projector', 'Phone 390x844, projector (key views)'],
];

// States drawn on the component page (support/pages/harness.tsx) rather than on a route.
const COMPONENT_PAGE = new Set([
  'landing/busy',
  'landing/server-down',
  'demo/links',
  'console/shortcut-help',
  'console/voice-requesting',
  'console/voice-listening',
  'console/voice-denied',
  'console/voice-error',
  'register/approve-cancelled',
  'register/approve-declined',
  'error/boundary',
  'boot/config-error',
]);
const mark = (view, state) => (COMPONENT_PAGE.has(`${view}/${state}`) ? ' (component page)' : '');

const dir = resolve(process.argv[2] ?? 'ui-screens-out');
mkdirSync(dir, { recursive: true });

/** Splits one file name into its parts, or null when it does not follow the pattern. */
export function parseName(file) {
  const m = /^(.+?)--(.+)--([a-z]+-[a-z]+)\.png$/.exec(file);
  return m === null ? null : { view: m[1], state: m[2], project: m[3], file };
}

const entries = readdirSync(dir)
  .map(parseName)
  .filter((e) => e !== null)
  .sort((a, b) => a.view.localeCompare(b.view) || a.state.localeCompare(b.state));

/** view -> state -> project -> file */
const tree = new Map();
for (const e of entries) {
  if (!tree.has(e.view)) tree.set(e.view, new Map());
  const states = tree.get(e.view);
  if (!states.has(e.state)) states.set(e.state, new Map());
  states.get(e.state).set(e.project, e.file);
}

const label = (id) => PROJECTS.find(([p]) => p === id)?.[1] ?? id;
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let md = '# UI screens\n\n';
md += `${entries.length} screenshots, ${tree.size} views, ${[...tree.values()].reduce((n, s) => n + s.size, 0)} states.\n\n`;
md += 'Columns: ' + PROJECTS.map(([, text]) => text).join('; ') + '.\n\n';
for (const [view, states] of tree) {
  md += `## ${view}\n\n| State | ${PROJECTS.map(([, text]) => text).join(' | ')} |\n|---|${PROJECTS.map(() => '---').join('|')}|\n`;
  for (const [state, files] of states) {
    md += `| ${state}${mark(view, state)} | ${PROJECTS.map(([p]) => (files.has(p) ? `[png](${files.get(p)})` : '-')).join(' | ')} |\n`;
  }
  md += '\n';
}
writeFileSync(join(dir, 'INDEX.md'), md);

let html =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UI screens</title>';
html +=
  '<style>body{font:14px system-ui,sans-serif;margin:16px;background:#fafafa;color:#111}h2{margin-top:32px}.state{margin:12px 0}.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}figcaption{font-size:12px;color:#555}img{display:block;max-width:360px;border:1px solid #ccc;background:#fff}.phone img{max-width:180px}nav a{margin-right:12px}</style></head><body>';
html += `<h1>UI screens</h1><p>${entries.length} screenshots across ${tree.size} views. Click an image for full size.</p><nav>`;
for (const view of tree.keys()) html += `<a href="#${esc(view)}">${esc(view)}</a>`;
html += '</nav>';
for (const [view, states] of tree) {
  html += `<h2 id="${esc(view)}">${esc(view)}</h2>`;
  for (const [state, files] of states) {
    html += `<div class="state"><strong>${esc(state)}${esc(mark(view, state))}</strong><div class="row">`;
    for (const [p] of PROJECTS) {
      const file = files.get(p);
      if (file === undefined) continue;
      html += `<figure class="${p.startsWith('phone') ? 'phone' : ''}"><a href="${esc(file)}"><img loading="lazy" src="${esc(file)}" alt="${esc(view)} ${esc(state)} ${esc(p)}"></a><figcaption>${esc(label(p))}</figcaption></figure>`;
    }
    html += '</div></div>';
  }
}
html += '</body></html>';
writeFileSync(join(dir, 'index.html'), html);

writeFileSync(
  join(dir, 'manifest.json'),
  JSON.stringify({ count: entries.length, views: [...tree.keys()], entries }, null, 2),
);
process.stdout.write(`indexed ${entries.length} screenshots in ${tree.size} views\n`);
