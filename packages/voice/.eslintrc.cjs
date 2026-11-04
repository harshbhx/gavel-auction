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
      // Pure, clock-free zones: time is always passed in. This list replaces the base list, so the
      // import and re-export guards are repeated here.
      files: [
        'src/decide/**/*.ts',
        'src/parser/**/*.ts',
        'src/segment/**/*.ts',
        'src/pipeline/**/*.ts',
        'src/audio/**/*.ts',
        'src/stt/**/*.ts',
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
            selector:
              'ExportNamedDeclaration[exportKind!="type"][source.value=/^@gavel\\/(engine|payments)(\\/|$)/]',
            message: 'Re-exporting values from engine or payments is not allowed.',
          },
          {
            selector:
              'ExportAllDeclaration[exportKind!="type"][source.value=/^@gavel\\/(engine|payments)(\\/|$)/]',
            message: 'Re-exporting values from engine or payments is not allowed.',
          },
          {
            selector: 'ImportDeclaration[source.value=/^node:/]',
            message: 'Node built-ins are not allowed here: this code is bundled for the browser.',
          },
          {
            selector:
              "MemberExpression[object.name='Date'], NewExpression[callee.name='Date'], CallExpression[callee.name='Date']",
            message: 'The clock is not allowed here: take time as an input.',
          },
          {
            selector:
              "MemberExpression[object.name='Math']:matches([property.name='random'], [property.value='random'])",
            message: 'Math.random is not allowed here: take randomness as an input.',
          },
          {
            selector: "MemberExpression[object.name='performance']",
            message: 'performance is not allowed here: take time as an input.',
          },
          {
            selector: "MemberExpression[object.name='crypto']",
            message: 'crypto is not allowed here: take randomness and ids as inputs.',
          },
        ],
      },
    },
  ],
};
