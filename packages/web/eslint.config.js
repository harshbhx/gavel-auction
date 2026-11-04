import root from '../../eslint.config.js';

export default [
  ...root,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
];
