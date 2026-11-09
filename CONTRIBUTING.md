# Contributing to GAVEL

This guide covers everything needed to make a change: set up the repository, run the checks, follow the branch and commit rules, and know who owns which files. The delivery plan lives in [docs/specs/MASTER-PLAN.md](docs/specs/MASTER-PLAN.md); read it first to see which wave an issue belongs to.

## Setup

Requirements: Node.js 22 or newer (the version is pinned in `.nvmrc`) and npm.

```
git clone https://github.com/harshbhx/gavel-auction.git
cd gavel-auction
nvm use
npm ci
```

Copy `.env.example` to `.env` only when a task needs configuration. Use PayPal sandbox values only. Never commit a real key, token or secret; the secret scanners run on every pull request and will fail the build.

To confirm the setup works, run the unit tests:

```
npm test
```

## Scripts

All scripts run from the repository root.

| Script                            | Purpose                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `npm run build`                   | Build every package with TypeScript project references             |
| `npm run typecheck`               | Type-check the repository and each package                         |
| `npm run lint`                    | ESLint with zero warnings allowed                                  |
| `npm run format:check`            | Check formatting; `npm run format` rewrites files                  |
| `npm test`                        | Unit tests for every package                                       |
| `npm run test:pkg -- unit:engine` | Unit tests for one package (replace the project name)              |
| `npm run test:coverage`           | Unit tests with coverage and the threshold check                   |
| `npm run test:property`           | Property-based tests                                               |
| `npm run test:scenarios`          | In-process scenario tests                                          |
| `npm run check:ascii`             | Fail on any non-ASCII character in checked files                   |
| `npm run check:banned-words`      | Fail on banned words in checked files                              |
| `npm run check:deps`              | Dependency boundaries and engine purity                            |
| `npm run check:ownership`         | Verify a pull request touches one area only                        |
| `npm run report`                  | Build the test report (`report/summary.json`, `report/index.html`) |

Some scripts print "not implemented" until the issue that owns them is merged. That is expected.

## Branch and commit rules

- One issue per pull request. Branch name: `<type>/<KEY>-<slug>`, for example `feat/ENG-04-ledger-model`.
- The pull request title starts with the issue key: `ENG-04: append-only ledger model`.
- The squash commit on `main` takes the pull request title, so the title is the rule that shapes history: `KEY: subject`, at most 72 characters (CI checks both). Commits on a branch are squashed away and follow Conventional Commits below; they are linted only on the pull request, not on `main`.
- Commits follow Conventional Commits: `type(scope): subject`. Allowed types are feat, fix, test, docs, chore, refactor, perf, ci and build. Allowed scopes are shared, engine, payments, voice, server, web, e2e, infra, docs and repo. The header is lower case, has no trailing period and is at most 72 characters.
- Pull request bodies include a Summary, What changed and How to test, and one `Closes #<n>` line per issue.
- Do not force-push a shared branch. If `main` moved, merge it into your branch.
- Files are plain ASCII. Keep prose neutral and technical.

## File ownership

Every path has one owning area. A pull request should change files in one area only. A pull request that has to span areas needs the `cross-area` label, which a maintainer applies.

| Area | Paths                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------- |
| ENG  | `packages/engine/**`, `docs/specs/engine/**`                                                                               |
| PAY  | `packages/payments/**`, `docs/GATES.md`, `docs/specs/payments/**`                                                          |
| RT   | `packages/shared/**`, `packages/server/**`, `docs/specs/realtime/**`                                                       |
| VOI  | `packages/voice/**`, `docs/specs/voice/**`                                                                                 |
| WEB  | `packages/web/**`, `docs/specs/web/**`                                                                                     |
| QA   | `packages/e2e/**`, `infra/**`, `.github/**`, `scripts/**`, `docs/specs/quality/**`, root tooling config, `CONTRIBUTING.md` |

The authoritative map is `scripts/ownership.map.json`; reviewers are assigned from `.github/CODEOWNERS`.

## Interface-first rule

Exported symbols are contracts between areas. A change to an exported type, function or wire message is made in its own pull request, before the code that depends on it. The interface pull request carries the `interface` label, updates the committed API report for the package, and merges first. Dependent pull requests rebase on it afterwards. Do not change an exported signature as a side effect of a feature change.

## Wave plan

Work is ordered in waves. [docs/specs/MASTER-PLAN.md](docs/specs/MASTER-PLAN.md) lists each wave, its issues and their dependencies. Start an issue only when everything under its "Depends on" heading is merged.

## Add a scenario

Scenarios are YAML files in `packages/e2e/scenarios/`, named `S<nn>-<slug>.yaml`, and are validated by the schema in `packages/e2e/src/dsl/schema.ts`.

1. Copy `S01-happy-path.yaml` and change the id, steps and expectations.
2. Keep time and randomness explicit in the file; scenarios must be deterministic.
3. Run `npm run test:scenarios`. The loader rejects a file that does not match the schema.

## Add a fixture

Fixtures live under `packages/<name>/fixtures/` next to the code they feed. Keep each file small, deterministic and free of secrets. Script-built fixtures (for example the audio set) come from their `generate.mjs` script and must be regenerated, not edited by hand. Run `node scripts/check-fixtures.mjs` after adding one.

## Run a gate

A gate is a recorded question about PayPal sandbox behaviour. The procedure and the current status of every gate are in [docs/GATES.md](docs/GATES.md). To run one: follow its Setup and Requests lines with sandbox credentials, fill in Observed, Verdict, Decision and Links, and set the date and name. A gate is closed only when its status is PASS or FAIL with a recorded decision.

## Report a security issue

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
