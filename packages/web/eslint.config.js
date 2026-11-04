import root from '../../eslint.config.js';

export default [
  ...root,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    // R-WEB-002: user-facing text comes from src/copy by key. App.tsx predates the catalog.
    files: ['src/**/*.tsx'],
    ignores: ['src/App.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/\\S/]',
          message: 'Use a catalog key from src/copy/en.ts instead of literal JSX text.',
        },
        {
          selector: "JSXAttribute[name.name='aria-label'] > Literal",
          message: 'Use a catalog key from src/copy/en.ts for aria-label.',
        },
      ],
    },
  },
];
