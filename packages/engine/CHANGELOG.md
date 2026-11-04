# Changelog

All notable changes to `@gavel/engine`. Money is integer cents; the ledger format and hash vector are documented in the package README.

## Unreleased

### Added

- Redacted public export: a second hash chain (version 2) without ceilings, hold references, leaders or sealed amounts, tied to the private ledger by `fullHash` (ENG-RT-12).
- Golden fixtures for promote, revoke, complete, abort and closed-lot bids, and an `abort` step op (R-ENG-066, R-ENG-112, R-ENG-113).
- Seeded differential test against the Python reference, 2000 scenarios per run (R-ENG-114).

### Changed

- The golden runner sends every bid to the engine, including bids past the deadline or after the hammer, and compares the engine's reason codes without folding them. `complete` takes the bidder and amount from the fixture.

## Release readiness (R-ENG-122, R-ENG-123, R-ENG-124)

Run these in GitHub Actions; none of them is meant to run on a developer VM.

| Gate               | How it runs                                                     | Pass condition                                                                                                 |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Typecheck and lint | `ci.yml` jobs `typecheck` and `lint`                            | no errors, zero warnings                                                                                       |
| Unit and property  | `ci.yml` jobs `unit` and `property`                             | all green                                                                                                      |
| Coverage           | `ci.yml` job `coverage` (`npm run test:coverage`)               | engine at or above 95% lines and 90% branches (vitest config), and `coverage.thresholds.json` only ratchets up |
| Trace check        | `engine-readiness.yml` (`npm run check:trace -w @gavel/engine`) | every `R-ENG-` id is named by a test title and every test has a `T-ENG-` id; exits 1 otherwise                 |
| Python reference   | `ci.yml` job `reference-python`                                 | pytest green, golden runner passes all parity fixtures                                                         |
| Differential       | `differential.yml`                                              | 2000 seeded scenarios agree on winner, price, ranking and reasons                                              |

### API review checklist

- [ ] Every export of `src/index.ts` is documented in the package README and has a test that imports it from the package entry.
- [ ] No export exposes a mutable structure; state and ledger entries are plain readonly data.
- [ ] Every command in `commands.ts` has a decide function, a reducer path and at least one rejection test.
- [ ] Every error code in `errors.ts` and reason in `reasons.ts` is raised by at least one test.
- [ ] The engine imports nothing from other workspace packages, the network, the clock or random sources (`check:imports`).
- [ ] The hash vector in the README matches the value asserted in the tests.
- [ ] Open items before declaring the engine stable: package README (#177) and the performance budget (#170).
