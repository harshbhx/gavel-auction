// Decides whether a pull request changes anything but documentation.
// Input: the changed paths, one per line, listed with rename detection off so that both the
// removed and the added path of a move are present. Output: code=true or code=false.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DOCS = /^(docs\/.*\.md|[^/]*\.md)$/;
// These are read by tests or hold the only credential-shape scan, so they count as code.
const SPECIAL = /^(docs\/(GATES|DECISIONS)\.md|docs\/evidence\/.*)$/;

export function touchesCode(paths) {
  const files = paths.filter((p) => p !== '');
  if (files.length === 0) return true;
  return files.some((p) => SPECIAL.test(p) || !DOCS.test(p));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  const out = execFileSync('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'], {
    encoding: 'utf8',
  });
  process.stdout.write(`code=${touchesCode(out.split('\n'))}\n`);
}
