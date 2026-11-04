#!/usr/bin/env node
// Checks that a branch name and PR title tie the PR to one issue (R-QA-007).
//   branch: <type>/<KEY>-<slug>   e.g. feat/ENG-04-ledger-model
//   title:  starts with the branch key, e.g. "ENG-04: append-only ledger model"
//           (extra keys may follow the first: "ENG-04 ENG-05: ...")
// Inputs: --branch / BRANCH_NAME and --title / PR_TITLE. Prints a fix hint and exits 1 on failure.
import { fileURLToPath } from 'node:url';

export const BRANCH_RE =
  /^(feat|fix|test|docs|chore|refactor|perf|ci|build)\/([A-Z]{2,4}-\d{2})-[a-z0-9-]+$/;
const TITLE_RE = /^([A-Z]{2,4}-\d{2})(?: [A-Z]{2,4}-\d{2})*: \S/;

/** Returns a list of problems; an empty list means the branch and title are valid. */
export function validate(branch, title) {
  const problems = [];
  const b = BRANCH_RE.exec(branch);
  if (!b) {
    problems.push(
      `Branch "${branch}" must look like <type>/<KEY>-<slug>, for example feat/ENG-04-ledger-model. ` +
        'The type is one of feat, fix, test, docs, chore, refactor, perf, ci, build; the key is ' +
        'upper case with two digits; the slug is lower case letters, digits and dashes.',
    );
  }
  const t = TITLE_RE.exec(title);
  if (!t) {
    problems.push(
      `Title "${title}" must start with the issue key, for example "ENG-04: append-only ledger model".`,
    );
  } else if (b && t[1] !== b[2]) {
    problems.push(
      `Title starts with ${t[1]} but the branch key is ${b[2]}; the title must start with ${b[2]}.`,
    );
  }
  return problems;
}

function arg(name, envName) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  return process.env[envName] ?? '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = validate(arg('branch', 'BRANCH_NAME'), arg('title', 'PR_TITLE'));
  if (problems.length > 0) {
    console.log('Branch and PR title check failed:\n');
    for (const p of problems) console.log(`- ${p}`);
    console.log('\nRename the branch or edit the PR title, then the check runs again.');
    process.exit(1);
  }
  console.log('branch and title ok');
}
