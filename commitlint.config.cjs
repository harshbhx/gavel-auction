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
];

module.exports = {
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
