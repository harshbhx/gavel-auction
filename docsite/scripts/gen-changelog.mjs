#!/usr/bin/env node
// Renders the repo-root CHANGELOG.md as a docs page (content/docs/(learn)/roadmap/changelog.mdx).
// The page is generated, so the site can never differ from the file. Run with --check to fail when
// the committed page is out of date (CI does this).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const outFile = join(here, '..', 'content', 'docs', '(learn)', 'roadmap', 'changelog.mdx');
const repo = 'https://github.com/harshbhx/gavel-auction';

let src;
try {
  src = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
} catch (e) {
  throw new Error(`gen-changelog: cannot read CHANGELOG.md: ${e.message}`);
}

// Escape what MDX would read as JSX or an expression, outside inline code spans.
function escapeProse(line) {
  return line
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith('`') ? part : part.replace(/[{}]/g, (c) => `\\${c}`).replace(/</g, '&lt;')))
    .join('');
}

// Turn a repo-relative link into a GitHub link and a bare pull request or run URL into short link text.
function links(line) {
  return line
    .replace(/\]\((?!https?:|#|\/)([^)]+)\)/g, (_m, p) => `](${repo}/blob/main/${p})`)
    .replace(/:? (https:\/\/github\.com\/harshbhx\/gavel-auction\/pull\/(\d+))(?=\s|$)/g, ' ([#$2]($1))')
    .replace(/(?<![(\[])(https:\/\/github\.com\/harshbhx\/gavel-auction\/actions\/runs\/(\d+))/g, '[run $2]($1)');
}

const lines = src.split('\n');
const first = lines.findIndex((l) => l.startsWith('## '));
if (first < 0) throw new Error('gen-changelog: no entries found in CHANGELOG.md');

const entries = [];
for (let i = first; i < lines.length; i += 1) {
  if (lines[i].startsWith('## ')) entries.push({ head: lines[i].slice(3).trim(), body: [] });
  else entries[entries.length - 1].body.push(lines[i]);
}

const out = [];
out.push('---');
out.push('title: Changelog');
out.push('description: What changed in GAVEL, day by day, with a link to every merged pull request.');
out.push('icon: History');
out.push('---');
out.push('');
out.push('{/* Generated from CHANGELOG.md by scripts/gen-changelog.mjs. Edit the changelog, not this page. */}');
out.push('');
out.push(
  'Each day lists what was Added, Changed and Fixed, newest first. Dates are UTC and come from the merged pull requests on `main`. The source is [CHANGELOG.md](' +
    repo +
    '/blob/main/CHANGELOG.md) in the repository. For what is proven and what comes next, see [Limits and next steps](/docs/roadmap/limits).',
);
out.push('');

for (const e of entries) {
  const m = /^(\d{4}-\d{2}-\d{2}) - (.+)$/.exec(e.head);
  const label = m ? m[1] : e.head === 'Unreleased' ? 'Unreleased' : e.head;
  const title = m ? m[2] : e.head === 'Unreleased' ? 'Unreleased: in flight' : e.head;
  const kind = m ? 'day' : e.head === 'Unreleased' ? 'open' : 'note';
  out.push(`<ChangelogDay label="${label}" kind="${kind}">`);
  out.push('');
  out.push(`## ${escapeProse(title)}`);
  out.push('');
  let inCode = false;
  for (const raw of e.body) {
    if (raw.startsWith('```')) inCode = !inCode;
    out.push(inCode || raw.startsWith('```') ? raw : links(escapeProse(raw)));
  }
  while (out[out.length - 1] === '') out.pop();
  out.push('');
  out.push('</ChangelogDay>');
  out.push('');
}

const text = out.join('\n').replace(/\n{3,}/g, '\n\n');
const result = `${text.trimEnd()}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outFile, 'utf8');
  } catch {
    // missing file counts as out of date
  }
  if (current !== result) {
    console.error('gen-changelog: docsite changelog page is out of date. Run: node scripts/gen-changelog.mjs');
    process.exit(1);
  }
  console.log('gen-changelog: page is up to date');
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, result);
  console.log(`gen-changelog: wrote ${outFile} (${entries.length} entries)`);
}
