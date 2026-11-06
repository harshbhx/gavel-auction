// Decides whether a pull request changes anything but documentation.
// Input: the changed paths, one per line, listed with rename detection off so that both the
// removed and the added path of a move are present. Output: code=true or code=false.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REQUIRED as CLEAN_CLONE_REQUIRED } from './clean-clone-check.mjs';

const DOCS = /^(docs\/.*\.md|[^/]*\.md)$/;
// These are read by tests or hold the only credential-shape scan, so they count as code.
// README.md, SECURITY.md and docs/DEMO.md are asserted on by packages/e2e/test/repo-contracts.test.ts.
const SPECIAL = /^(README\.md|SECURITY\.md|docs\/(GATES|DECISIONS|DEMO)\.md|docs\/evidence\/.*)$/;
// Docs that tests, packages or scripts/clean-clone-check.mjs read. Removing or editing one can
// break a check the docs-only path would skip, so they count as code too.
// The clean-clone list is imported so it cannot drift from the script that enforces it.
const READ_BY_CHECKS = new Set([
  ...CLEAN_CLONE_REQUIRED,
  'docs/SECURITY-REVIEW.md',
  'docs/PRIVACY.md',
  'docs/PLAN.md',
]);
const READ_BY_CHECKS_PATTERN = /^docs\/RUNBOOK-[^/]*\.md$/;

export function touchesCode(paths) {
  const files = paths.filter((p) => p !== '');
  if (files.length === 0) return true;
  return files.some(
    (p) =>
      SPECIAL.test(p) || READ_BY_CHECKS.has(p) || READ_BY_CHECKS_PATTERN.test(p) || !DOCS.test(p),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  const out = execFileSync('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'], {
    encoding: 'utf8',
  });
  process.stdout.write(`code=${touchesCode(out.split('\n'))}\n`);
}
