/* Guard rails for packages/voice (R-VOX-061, determinism rules of SPEC-voice section 3). */

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { es2022: true },
  rules: {
    // Type-only imports of engine and payments are allowed; value imports are not.
    'no-restricted-syntax': [
      'error',
      {
        selector:
          'ImportDeclaration[importKind!="type"]:matches([source.value=/^@gavel\\/(engine|payments)(\\/|$)/], [source.value=/(^|\\/)packages\\/(engine|payments)(\\/|$)/])',
        message:
          'packages/voice may import packages/engine and packages/payments as types only (use "import type").',
      },
      {
        selector:
          'ExportNamedDeclaration[exportKind!="type"][source.value=/^@gavel\\/(engine|payments)(\\/|$)/]',
        message: 'Re-exporting values from engine or payments is not allowed.',
      },
      {
        selector:
          'ExportAllDeclaration[exportKind!="type"][source.value=/^@gavel\\/(engine|payments)(\\/|$)/]',
        message: 'Re-exporting values from engine or payments is not allowed.',
      },
    ],
  },
  overrides: [
    {
      // Pure, clock-free zones: time is always passed in.
      files: [
        'src/decide/**/*.ts',
        'src/parser/**/*.ts',
        'src/segment/**/*.ts',
        'src/pipeline/**/*.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'ImportDeclaration[importKind!="type"]:matches([source.value=/^@gavel\\/(engine|payments)(\\/|$)/], [source.value=/(^|\\/)packages\\/(engine|payments)(\\/|$)/])',
            message:
              'packages/voice may import packages/engine and packages/payments as types only (use "import type").',
          },
          {
            selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
            message: 'Date.now is not allowed here: take time as an input.',
          },
          {
            selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
            message: 'Math.random is not allowed here: take randomness as an input.',
          },
          {
            selector: "NewExpression[callee.name='Date']",
            message: 'new Date is not allowed here: take time as an input.',
          },
        ],
      },
    },
  ],
};
