// Guard rails for packages/voice (R-VOX-061, determinism rules of SPEC-voice section 3).
// Flat config for the root ESLint 9; it carries the same rules the old .eslintrc.cjs had.
import tseslint from 'typescript-eslint';

const ENGINE_PAYMENTS = '/^@gavel\\/(engine|payments)(\\/|$)/';

/** Type-only imports of engine and payments are allowed; value imports and re-exports are not. */
const IMPORT_GUARDS = [
  {
    selector: `ImportDeclaration[importKind!="type"]:matches([source.value=${ENGINE_PAYMENTS}], [source.value=/(^|\\/)packages\\/(engine|payments)(\\/|$)/])`,
    message:
      'packages/voice may import packages/engine and packages/payments as types only (use "import type").',
  },
  {
    selector: `ExportNamedDeclaration[exportKind!="type"][source.value=${ENGINE_PAYMENTS}]`,
    message: 'Re-exporting values from engine or payments is not allowed.',
  },
  {
    selector: `ExportAllDeclaration[exportKind!="type"][source.value=${ENGINE_PAYMENTS}]`,
    message: 'Re-exporting values from engine or payments is not allowed.',
  },
];

/** Clock, randomness and node built-ins are inputs in the pure zones, never read directly. */
const PURE_GUARDS = [
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
];

export default [
  { ignores: ['**/node_modules/**', '**/coverage/**'] },
  // The root config holds the general rules; a disable comment for one of them is not unused.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: { 'no-restricted-syntax': ['error', ...IMPORT_GUARDS] },
  },
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
    rules: { 'no-restricted-syntax': ['error', ...IMPORT_GUARDS, ...PURE_GUARDS] },
  },
  {
    // Known exceptions inside the clock-free zones, kept to the engine and payments import guards:
    // failover.ts and groq.ts hold the one default real clock; dedupe.ts hashes with node:crypto
    // (a browser-safe hash is a follow-up, see issue 942).
    files: ['src/segment/dedupe.ts', 'src/stt/failover.ts', 'src/stt/groq.ts'],
    rules: { 'no-restricted-syntax': ['error', ...IMPORT_GUARDS] },
  },
];
