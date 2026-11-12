// Conventional Commits with the project scope list (R-QA-006).
const TYPES = ['feat', 'fix', 'test', 'docs', 'chore', 'refactor', 'perf', 'ci', 'build'];
const SCOPES = [
  'shared',
  'engine',
  'payments',
  'voice',
  'server',
  'web',
  'e2e',
  'infra',
  'docs',
  'repo',
  'hf',
  'api',
  'og',
];

// Merge commits (agents update PR branches with 'merge main into X', git writes 'Merge branch ...')
// have no type or scope, so they are skipped. Every other message is linted by the rules below.
const MERGE_COMMIT = /^merge\b/i;
// Older agent merges were titled 'chore: merge main into <branch>' (no scope).
const MAIN_MERGE_COMMIT = /^chore: merge main into /;

module.exports = {
  ignores: [
    (message) => MERGE_COMMIT.test(String(message).trimStart()),
    (message) => MAIN_MERGE_COMMIT.test(String(message).trimStart()),
  ],
  rules: {
    'type-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    'type-enum': [2, 'always', TYPES],
    'scope-empty': [2, 'never'],
    'scope-case': [2, 'always', 'lower-case'],
    'scope-enum': [2, 'always', SCOPES],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72],
  },
};
