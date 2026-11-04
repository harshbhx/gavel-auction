# Golden fixtures

JSON files in this directory describe a scripted auction and its expected outcome. The TypeScript engine and the Python reference both run them, so the files are shared byte for byte. The format is defined by `SCHEMA.json`.

Fields: `name`, `parity` (true when the Python reference must produce the same result), `config`, `steps`, `expect`.

Step ops: `register`, `bid`, `tick`, `hammer`, `promote`, `revoke`, `complete`. Every step carries `at` in integer epoch milliseconds. Money is integer cents.

`expect` may hold `winner`, `price`, `ranking`, `rejects` (reject reasons in order) and `endsAt`.

Load fixtures with `loadFixtures(dir)` from `src/testing/fixtures.ts`; a malformed file fails with its file name.
