// Checks the glossary and its uses. Plain node, no build, so it is safe to run anywhere:
//   node scripts/check-glossary.mjs
// Fails (exit 1) when:
//  - an entry has a missing field, a duplicate id, or a tooltip over 260 characters;
//  - an entry's `page` is not a real docs page, or a `see` id does not exist;
//  - a <Term id="..."> in any .mdx page names an entry that does not exist;
//  - a <Term> sits in a heading, in a code block or in frontmatter (tooltips belong in prose);
//  - the same term is marked twice on one page (first use only).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const glossary = JSON.parse(readFileSync(join(root, 'content/glossary.json'), 'utf8')).entries;
const errors = [];
const err = (m) => errors.push(m);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const docsDir = join(root, 'content/docs');
const mdx = walk(docsDir).filter((p) => p.endsWith('.mdx'));
const urlOf = (file) => {
  const parts = relative(docsDir, file)
    .replace(/\.mdx$/, '')
    .split('/')
    .filter((s) => !/^\(.*\)$/.test(s));
  if (parts[parts.length - 1] === 'index') parts.pop();
  return '/docs' + (parts.length ? '/' + parts.join('/') : '');
};
const urls = new Set(mdx.map(urlOf));
urls.add('/docs');

const ids = new Set();
for (const e of glossary) {
  for (const f of ['id', 'term', 'short', 'page']) if (!e[f]) err(`glossary: entry ${e.id ?? '?'} lacks "${f}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) err(`glossary: id "${e.id}" is not kebab-case`);
  if (ids.has(e.id)) err(`glossary: duplicate id "${e.id}"`);
  ids.add(e.id);
  if (e.short && e.short.length > 260) err(`glossary: "${e.id}" tooltip is ${e.short.length} characters (max 260)`);
  if (e.page && !urls.has(e.page)) err(`glossary: "${e.id}" page ${e.page} is not a docs page`);
}
for (const e of glossary) for (const s of e.see ?? []) if (!ids.has(s)) err(`glossary: "${e.id}" sees unknown "${s}"`);

// Every /docs/... path named in the tour and in the curated related list must be a real page.
for (const f of ['lib/tour.ts', 'lib/related.ts']) {
  for (const m of readFileSync(join(root, f), 'utf8').matchAll(/'(\/docs[^']*)'/g)) {
    if (!urls.has(m[1])) err(`${f}: ${m[1]} is not a docs page`);
  }
}

let uses = 0;
for (const file of mdx) {
  const rel = relative(root, file);
  const src = readFileSync(file, 'utf8');
  const seen = new Set();
  let inFence = false;
  let inFront = false;
  src.split('\n').forEach((line, i) => {
    if (i === 0 && line.trim() === '---') {
      inFront = true;
      return;
    }
    if (inFront) {
      if (line.trim() === '---') inFront = false;
      else if (/<Term\b/.test(line)) err(`${rel}:${i + 1}: <Term> in frontmatter`);
      return;
    }
    if (/^\s*```/.test(line)) inFence = !inFence;
    const found = [...line.matchAll(/<Term\s+id="([^"]*)"/g)];
    if (!found.length) return;
    if (inFence) err(`${rel}:${i + 1}: <Term> inside a code block`);
    if (/^#{1,6}\s/.test(line)) err(`${rel}:${i + 1}: <Term> in a heading`);
    for (const m of found) {
      uses++;
      if (!ids.has(m[1])) err(`${rel}:${i + 1}: unknown term id "${m[1]}"`);
      if (seen.has(m[1])) err(`${rel}:${i + 1}: "${m[1]}" is already marked on this page (first use only)`);
      seen.add(m[1]);
    }
  });
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problem(s).`);
  process.exit(1);
}
console.log(`glossary ok: ${glossary.length} entries, ${uses} <Term> uses in ${mdx.length} pages`);
