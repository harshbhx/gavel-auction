# Golden fixtures

JSON files in this directory describe a scripted auction and its expected outcome. The TypeScript engine and the Python reference both run them, so the files are shared byte for byte. The format is defined by `SCHEMA.json`.

Fields: `name`, `parity` (true when the Python reference must produce the same result), `config`, `steps`, `expect`.

Step ops: `register`, `bid`, `tick`, `hammer`, `promote`, `revoke`, `complete`, `abort`, `pause`, `resume`, `extend`. Every step carries `at` in integer epoch milliseconds. Money is integer cents.

`complete` takes the bidder and the captured amount (`amount`) from the step, so a wrong winner or a wrong amount can be presented. `extend` takes the added time in milliseconds from `amount`. The Python reference supports every op except `complete` (D-0030), so fixtures that use `complete`, and fixtures with a ladder, set `parity` to false.

`rejects` holds the engine's reason code, except that the reference's `closed` stands for the engine's `lot_not_open`.

`expect` may hold `winner`, `price`, `ranking`, `rejects` (reject reasons in order) and `endsAt`.

Load fixtures with `loadFixtures(dir)` from `src/testing/fixtures.ts`; a malformed file fails with its file name.
