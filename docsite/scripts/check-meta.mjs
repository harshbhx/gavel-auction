// Fails when an exported page lacks link-preview tags. Run after `next build`:
//   node scripts/check-meta.mjs out
// Every HTML page (the 404 page excepted) must carry og:title, og:description, og:image (absolute
// https URL on the docs host), og:image:alt, og:url, og:type, og:site_name, twitter:card =
// summary_large_image, twitter:title, twitter:image, twitter:image:alt, a canonical link and a
// theme-color. The images they name must exist in the export (checked for /og/*.png and the
// per-page /og/docs/**/image.png routes).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://docs.gavel.dualmindlab.tech';
const root = path.resolve(process.argv[2] ?? 'out');

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '_next') yield* htmlFiles(p);
    } else if (name.endsWith('.html') && name !== '404.html' && name !== '_not-found.html') yield p;
  }
}

function meta(html, key) {
  const tags = html.match(/<meta\s[^>]*>/g) ?? [];
  for (const tag of tags) {
    const k = /(?:name|property)="([^"]*)"/.exec(tag)?.[1];
    if (k === key) return /content="([^"]*)"/.exec(tag)?.[1];
  }
  return undefined;
}

const REQUIRED = [
  'og:title', 'og:description', 'og:image', 'og:image:alt', 'og:url', 'og:type', 'og:site_name',
  'twitter:card', 'twitter:title', 'twitter:image', 'twitter:image:alt', 'theme-color',
];

const problems = [];
let pages = 0;
for (const file of htmlFiles(root)) {
  pages += 1;
  const rel = path.relative(root, file);
  const html = readFileSync(file, 'utf8');
  for (const key of REQUIRED) if (!meta(html, key)) problems.push(`${rel}: missing ${key}`);
  if (meta(html, 'twitter:card') !== 'summary_large_image') problems.push(`${rel}: twitter:card is not summary_large_image`);
  if (!/<link rel="canonical" href="https:\/\/docs\.gavel\.dualmindlab\.tech/.test(html)) problems.push(`${rel}: missing canonical link`);
  const image = meta(html, 'og:image');
  if (image) {
    if (!image.startsWith(`${ORIGIN}/`)) problems.push(`${rel}: og:image is not an absolute URL on ${ORIGIN}: ${image}`);
    else if (!existsSync(path.join(root, image.slice(ORIGIN.length)))) problems.push(`${rel}: og:image file is not in the export: ${image}`);
  }
  if (meta(html, 'og:image') !== meta(html, 'twitter:image')) problems.push(`${rel}: og:image and twitter:image differ`);
}
if (pages === 0) problems.push(`no HTML pages found under ${root}`);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`link previews ok on ${pages} pages`);
