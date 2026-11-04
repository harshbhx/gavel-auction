// Runs on staged files only and never runs tests (R-QA-005).
const quote = (files) => files.map((f) => `"${f}"`).join(' ');

module.exports = {
  '*.{ts,tsx,js,mjs,cjs}': (files) => [
    `prettier --write ${quote(files)}`,
    `eslint --max-warnings 0 --no-warn-ignored ${quote(files)}`,
  ],
  '*.{json,md,yml,yaml,css,html}': (files) => [`prettier --write ${quote(files)}`],
  '*': (files) => [
    `node scripts/check-ascii.mjs ${quote(files)}`,
    `node scripts/check-banned-words.mjs ${quote(files)}`,
  ],
};
