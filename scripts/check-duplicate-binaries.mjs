// FIX-141: fail when a tracked file over 200 KB has a byte-identical twin at another path.
// Existing twins are listed in scripts/duplicate-binaries-allowlist.txt (one path per line);
// the list may only shrink. A group fails when any of its paths is not on the list.
// Playwright baselines (__screenshots__) are exempt: each project owns its own baseline.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MIN_BYTES = 200 * 1024;

export function findNewDuplicates(entries, allowed) {
  const groups = new Map();
  for (const e of entries) {
    if (e.size < MIN_BYTES || e.path.includes('__screenshots__/')) continue;
    if (!groups.has(e.oid)) groups.set(e.oid, []);
    groups.get(e.oid).push(e.path);
  }
  const bad = [];
  for (const paths of groups.values()) {
    if (paths.length > 1 && paths.some((p) => !allowed.has(p))) bad.push(paths.sort());
  }
  return bad;
}

function git(args, input) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, input });
  if (r.status !== 0) {
    console.error(`git ${args[0]} failed`);
    process.exit(2);
  }
  return r.stdout;
}

function main() {
  const tree = git(['ls-files', '-s', '-z']).split('\0').filter(Boolean);
  const meta = tree.map((l) => {
    const tab = l.indexOf('\t');
    return { oid: l.slice(0, tab).split(' ')[1], path: l.slice(tab + 1) };
  });
  const oids = [...new Set(meta.map((m) => m.oid))].join('\n') + '\n';
  const sizes = git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], oids)
    .split('\n')
    .filter(Boolean)
    .reduce((m, l) => m.set(l.split(' ')[0], Number(l.split(' ')[1])), new Map());
  const entries = meta.map((m) => ({ ...m, size: sizes.get(m.oid) ?? 0 }));
  const allowFile = new URL('./duplicate-binaries-allowlist.txt', import.meta.url);
  const allowed = new Set(
    readFileSync(allowFile, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#')),
  );
  const bad = findNewDuplicates(entries, allowed);
  if (bad.length > 0) {
    console.error('duplicate binaries over 200 KB (keep one copy and point references at it):');
    for (const g of bad) console.error(`  ${g.join('\n  ')}\n`);
    process.exit(1);
  }
  console.log('no new duplicate binaries over 200 KB');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
