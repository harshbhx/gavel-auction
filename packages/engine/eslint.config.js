// Package lint for @gavel/engine: the repository rules plus the determinism ban (R-ENG-121).
// Time and randomness enter the engine only through clock.ts and runtime.ts.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const BANNED_CALLS = [
  ['Date', 'now'],
  ['Math', 'random'],
  ['performance', 'now'],
  ['crypto', 'randomUUID'],
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/coverage/**', 'fixtures/**'] },
  // The root config bans node imports in src and src/node carries the matching disable comment;
  // this package config has no such rule, so that comment is not reported as unused here.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/clock.ts', 'src/runtime.ts', 'src/testing/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...BANNED_CALLS.map(([object, property]) => ({
          object,
          property,
          message: `${object}.${property} breaks determinism; take time and ids as inputs (R-ENG-121).`,
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'new Date reads the wall clock; take time as an input (R-ENG-121).',
        },
      ],
    },
  },
);
