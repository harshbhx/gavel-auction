# SPEC-quality: conventions, test strategy, infrastructure, submission

Area owner: quality (files: packages/e2e, infra/, .github/, docs/DECISIONS.md, docs/GATES.md format, docs/specs/SPEC-quality.md)
Key prefix: QA-. Requirement prefix: R-QA-. Test prefix: T-QA-.
Status: draft for review. Date: 2026-11-04. Deadline: 2026-11-12 12:00 PST (2026-11-13 01:30 IST).

---

## 1. Purpose and scope

GAVEL is a live auction in which every bid is backed by a PayPal authorization hold. The product is only credible if three things are true at the same time: the money invariants hold under failure, several developers can build in parallel without breaking each other, and a judge can verify both in under five minutes. This spec defines the machinery that makes those three things true.

In scope:

1. Repository conventions: monorepo layout, scripts, lint and format, commit and PR conventions, branch protection, CODEOWNERS, templates, contribution guide, how parallel work is split (wave plan, file ownership, interface-first order), formats of docs/DECISIONS.md and docs/GATES.md.
2. Test strategy: pyramid, per-package coverage gates, packages/e2e (Playwright), the scenario DSL and fixtures, nightly real-sandbox job, load and race tests, cross-browser and mobile matrix, property and mutation testing, test report generation, security review checklist, accessibility audit.
3. Infrastructure: GitHub Actions workflows, deploy to Render and Cloudflare, environments and secrets, uptime and warm-up, backups and export, observability.
4. Submission: video script and shot list, Devpost write-up outline, screenshot list, public-repo checklist, final submission checklist.

Out of scope: product behaviour of engine, payments, voice, realtime and web (owned by their own specs). This spec only consumes their interfaces and states what must be testable about them.

Hard constraints inherited from the hackathon rules and project rules:

- PayPal sandbox only. No live credentials anywhere. A sandbox-only guard is part of the test suite (T-QA-040).
- Public repository with a visible OSS license (MIT) at submission time; public YouTube video under 3:00; hosted URL; PayPal central to the product.
- Heavy work (builds, test suites, browsers, screenshots, load tests) runs in GitHub Actions. Developer machines run only typecheck, lint on changed files and single-package unit tests.
- Anything not yet verified against the PayPal sandbox is marked `UNVERIFIED (gate Gn)` with a stated fallback.

## 2. Definitions

| Term             | Meaning                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wave             | Group of issues that can start together. Wave 1 has no dependencies and needs no keys. Wave 2 needs wave 1 interfaces. Wave 3 is integration. Wave 4 is polish and submission.                                                                                     |
| Interface-first  | The issue that publishes types, a fake and fixtures for a module lands before any issue that implements or consumes the real module.                                                                                                                               |
| Gate (G1..G5)    | Day-1 experiments recorded in docs/GATES.md. G1 partial capture and remainder release. G2 card/guest AUTHORIZE. G3 honor period vs validity and reauthorize. G4 real webhook signature verification. G5 STT accuracy on noisy bids.                                |
| Scenario         | A declarative script (YAML or TS DSL) describing actors, a clock, injected faults and expected ledger and UI outcomes. Run by the scenario runner against in-process packages (fast) or the full stack (e2e).                                                      |
| Fake PayPal      | The in-memory/HTTP server in packages/payments that mimics the PayPal endpoints GAVEL uses, with fault injection hooks.                                                                                                                                            |
| Real-sandbox job | Workflow that exercises the PayPal sandbox with sandbox credentials stored as GitHub Actions secrets (repository-level today, see R-QA-043). Runs nightly and on manual dispatch only.                                                                             |
| Money invariants | I1 at most one capture per lot. I2 captured <= ceiling of the winner hold. I3 each non-winner hold voided exactly once. I4 captured + released = sum of holds for the lot. I5 outcome identical under duplicate, reordered and delayed webhooks and under retries. |
| Replay           | Recorded audio plus a recorded clock driven through the real parse and engine pipeline.                                                                                                                                                                            |
| Flake            | A test that fails and then passes on the same commit. Tracked and quarantined, never silently retried more than once.                                                                                                                                              |
| Freeze           | From D8 12:00 IST only fixes labelled `priority:P0` or `type:bug` merge.                                                                                                                                                                                           |

## 3. Requirements

### 3.1 Repository conventions

- R-QA-001 The root MUST be an npm workspaces monorepo with workspaces `packages/*`. Package names MUST be `@gavel/shared`, `@gavel/engine`, `@gavel/payments`, `@gavel/voice`, `@gavel/server`, `@gavel/web`, `@gavel/e2e`.
- R-QA-002 TypeScript MUST be strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`) via a single `tsconfig.base.json`; each package extends it and uses project references. Dependency direction MUST be: shared <- engine <- payments, voice <- server <- web (web imports only shared and wire types). A lint rule (`no-restricted-imports` plus a dependency-cruiser config) MUST fail the build on any reverse or skipping import. engine MUST NOT import node I/O modules (`fs`, `net`, `http`, `crypto` random, `Date.now`, `Math.random`).
- R-QA-003 The root `package.json` MUST expose these scripts, each of which MUST work from a clean clone after `npm ci`: `build`, `typecheck`, `lint`, `format`, `format:check`, `test` (unit, all packages), `test:pkg -- <name>`, `test:coverage`, `test:property`, `test:scenarios`, `test:e2e`, `test:e2e:sandbox`, `test:load`, `report`, `check:secrets`, `check:deps`, `check:ascii`, `check:banned-words`.
- R-QA-004 ESLint (flat config, typescript-eslint strict) and Prettier MUST be configured at the root only. `format:check` and `lint` MUST be CI-required. Prettier settings: 100 columns, single quotes, trailing commas `all`, LF line endings.
- R-QA-005 A pre-commit hook (lint-staged via husky) SHOULD run Prettier and ESLint on staged files only and `check:ascii` plus `check:banned-words` on staged text. The hook MUST complete in under 5 s on 2 CPUs for a 10-file change. The hook MUST NOT run tests.
- R-QA-006 Commit messages MUST follow Conventional Commits: `type(scope): subject` with type in {feat, fix, test, docs, chore, refactor, perf, ci, build} and scope in {shared, engine, payments, voice, server, web, e2e, infra, docs, repo}. Subject <= 72 chars, imperative, no trailing period. Enforced by commitlint in CI over every commit in the PR.
- R-QA-007 Branch names MUST be `<type>/<key>-<slug>`, for example `feat/ENG-04-ledger-model`. Each issue maps to exactly one branch and one PR. The PR title MUST start with the issue key: `ENG-04: append-only ledger model`.
- R-QA-008 `main` MUST be protected: PR required, 1 approving review (the CODEOWNER of every touched path), linear history (squash merge only), required status checks `ci / typecheck`, `ci / lint`, `ci / unit`, `ci / coverage`, `ci / scenarios`, `ci / e2e-fake`, `ci / secrets`, `ci / commitlint`, `ci / deps`; force pushes and deletions disabled; stale approvals dismissed on new commits; conversation resolution required. With a team of two the approving review MAY be self-merge after green CI on `docs/` only changes (rule recorded in DECISIONS.md D-0002).
- R-QA-009 `.github/CODEOWNERS` MUST map each package and directory to its single owner (section 4.1). A PR touching a path with an owner different from its author MUST request that owner automatically.
- R-QA-010 `.github/pull_request_template.md` MUST contain: issue key and link, summary, how to test (exact command), what was verified in the PayPal sandbox (or `n/a`), interfaces changed (yes/no and which), tests added (T-ids), screenshots for web changes, checklist (typecheck, lint, tests, docs, no secrets, ASCII only).
- R-QA-011 Issue templates MUST exist for: feature, bug, spike, gate, chore. Each MUST carry the headings of the issue body template (`## Spec`, `## Goal`, `## Scope`, `## Out of scope`, `## Interfaces`, `## Files`, `## Depends on`, `## Acceptance criteria`, `## Test plan`, `## Definition of done`, `## Size`).
- R-QA-012 CONTRIBUTING.md MUST document: setup, scripts, branch and commit rules, the file-ownership table, the interface-first rule, the wave plan pointer (docs/MASTER-PLAN.md), how to add a scenario, how to add a fixture, how to run a gate, and how to report a security issue.
- R-QA-013 File ownership: a PR MUST edit only files listed in the issue `## Files` section, except for lockfile updates and emitted type output. A path-ownership CI job (`check:ownership`) MUST fail a PR that touches a path outside the CODEOWNERS entries of its issue-key area unless the PR carries the label `cross-area` approved by the owner.
- R-QA-014 Interface-first: any change to an exported symbol of `@gavel/shared` MUST be a separate PR labelled `interface` that merges before consumers. `api-extractor` reports (`etc/*.api.md`) MUST be committed for every package; CI MUST fail when the report differs and the PR lacks the `interface` label.
- R-QA-015 docs/DECISIONS.md MUST be an append-only log in the format of section 4.7. Every decision that changes a contract, a library, a hosting choice or the scope MUST add an entry in the same PR.
- R-QA-016 docs/GATES.md MUST follow the format of section 4.8: one block per gate with question, setup, exact requests (secrets redacted), observed responses, verdict (PASS, FAIL, PARTIAL), decision and fallback. A gate without evidence MUST read `NOT RUN`.
- R-QA-017 Every text file committed MUST be ASCII except where a fixture needs unicode (listed in `.asciiignore`). Text MUST NOT mention how the code was produced, and MUST NOT contain the words listed in `scripts/banned-words.txt` (checked by `check:banned-words`; the list is kept out of the public tree by reading it from a CI secret `BANNED_WORDS` so the list itself is not committed).
- R-QA-018 Dependabot (or equivalent) MUST be disabled for the hackathon window to avoid churn; dependency changes happen only through `chore(repo)` PRs. `package-lock.json` MUST be committed and `npm ci` MUST be the only install command in CI.

### 3.2 Test strategy

- R-QA-020 The test pyramid MUST have these layers with target counts at submission: L1 unit and property (>= 600 tests), L2 contract (fake vs real PayPal shapes, wire schema, >= 60), L3 scenario (in-process, >= 40 scenarios), L4 e2e browser (Playwright, >= 14 specs), L5 real sandbox (>= 8 specs, nightly), L6 load and race (>= 4 scripts). Counts are reported by `report`.
- R-QA-021 Per-package line and branch coverage gates MUST be enforced in CI (Vitest v8 coverage): engine lines 95 / branches 90; payments 90 / 85; shared 95 / 90; voice 85 / 80; server 80 / 75; web 70 / 60 (components with logic only). Gates MUST be raised, never lowered, without a DECISIONS.md entry.
- R-QA-022 Unit tests MUST be deterministic: no wall clock, no `Math.random`, no network. Time comes from the `Clock` interface and randomness from a seeded PRNG exported by `@gavel/shared/testing`. A test that reads real time fails the `no-real-time` ESLint rule in test files.
- R-QA-023 Property-based tests (fast-check) MUST cover: engine (price monotonic, winner = highest valid bid, tie broken by earliest server time then lowest bidder id, soft-close never shortens, no accepted bid above ceiling), money (integer cents, no float, add/sub round trips), ledger (replay of events reproduces state, sum of holds = captured + released), saga (invariants I1..I5 under random fault schedules), wire (encode/decode round trip for every message). Each property MUST run >= 200 cases in CI with a printed seed; a failing seed MUST be committed as a regression fixture.
- R-QA-024 Mutation testing (Stryker) SHOULD run weekly and on manual dispatch for `packages/engine` and `packages/payments/src/saga`; target mutation score >= 80 percent on those paths. Surviving mutants MUST be listed in the report. Mutation runs MUST NOT block PRs.
- R-QA-025 The scenario runner (section 4.3) MUST execute the same scenario files in two modes: `inproc` (engine + fake PayPal + saga + room, no browser, < 2 s per scenario) and `stack` (full server and web under Playwright). A scenario MUST declare which modes it supports.
- R-QA-026 The following scenarios MUST exist and pass in `inproc` mode on every PR and in `stack` mode in `ci / e2e-fake`: S01 full happy path; S02 voice replay; S03 crash and resume mid-settlement; S04 duplicate webhooks; S05 out-of-order webhooks; S06 runner-up fallback; S07 winner hold voided externally; S08 winner hold expired; S09 client reconnect and resync; S10 abusive input; S11 simultaneous bid and hammer race; S12 soft-close extension; S13 PayPal 5xx on capture then recovery; S14 void failure retried to exactly once; S15 server restart with persisted ledger; S16 sandbox-only guard rejects live host. Details in section 8.
- R-QA-027 Crash and resume: the harness MUST be able to kill the server process (SIGKILL) at each named saga checkpoint (`after_winner_selected`, `before_capture_request`, `after_capture_request_before_response`, `after_capture_recorded`, `during_void_loop(k)`, `before_final_ledger`) and restart it against the same store. After restart the final state MUST satisfy I1..I5 and the capture request MUST reuse the same `PayPal-Request-Id`.
- R-QA-027a Checkpoint mapping. The scenario DSL names are kept; the runner translates them to the boundary labels the code already reports through its `boundary(label)` hook (payments saga and the server auction service both accept one). The runner kills the server when the hook sees the mapped label, and restarts it on the same store.

  | DSL checkpoint                          | Boundary label                                                                          | Reported by                                                                 |
  | --------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
  | `after_winner_selected`                 | `journaled:begin` (the journal moved HELD to CAPTURING with the first candidate chosen) | payments saga                                                               |
  | `before_capture_request`                | `before:capture`                                                                        | payments saga                                                               |
  | `after_capture_request_before_response` | `after:capture`                                                                         | payments saga (the fake has committed; the journal has not yet recorded it) |
  | `after_capture_recorded`                | `journaled:capture_ok`                                                                  | payments saga                                                               |
  | `during_void_loop:N`                    | the N-th hit of `before:void`, counting from 0                                          | payments saga void phase                                                    |
  | `before_final_ledger`                   | `before:engine:RecordSettlement`                                                        | server auction service, before the engine ledger gets the settlement record |

  `before_final_ledger` is an engine-ledger write made by the server, not a payments boundary, which is why it maps to a server label. A new DSL checkpoint needs a row here and a label in the code in the same change.

- R-QA-027b Invariant producers. I1 (one capture), I2 (captured not above the winner ceiling) and I3 (each non-winner voided exactly once, no capture after a void on the same hold) come from the fake PayPal's `assertFakeInvariants` (`packages/payments/src/fake/invariants.ts`) together with the saga checks of R-PAY-061; the runner calls them after every scenario. I4 (captured plus released equals the sum of holds) is computed by the runner from the fake's captured and released cents (`fakeReleasedCents`). I5 (same outcome under duplicate, reordered and delayed webhooks and retries) is produced by the runner running the scenario again with the webhook fault applied and comparing the final journal and ledger head. On the sandbox the reconciler (R-PAY-061) produces I1 to I4 and I5 is not asserted.
- R-QA-028 Contract tests MUST validate that every response shape produced by the fake PayPal parses with the same zod schemas used by the real client, and that recorded real sandbox responses (committed redacted fixtures under `packages/payments/fixtures/sandbox/`) parse with the fake's schemas. A shape diff MUST fail CI.
- R-QA-029 The nightly real-sandbox job MUST run specs R1..R8 (section 8.4) against the PayPal sandbox using environment secrets, upload redacted request/response transcripts as artifacts, and post pass or fail to the Needs-you board file via workflow summary. It MUST be skipped (not failed) when secrets are absent (fork PRs). Specs touching UNVERIFIED behaviour MUST be tagged `@gate:G1..G5` and report `inconclusive` rather than `fail` until the gate is closed in GATES.md.
- R-QA-030 Load and race tests MUST include: L1 100 simulated bidders over WebSocket at 10 bids/s for 60 s against one room (p95 bid-to-ack < 250 ms, zero lost or duplicate accepted bids, ledger consistent); L2 50 concurrent bids at the same cent value (exactly one accepted, others rejected with `BID_TOO_LOW` or `OUTBID`); L3 hammer racing 20 bids in the last 100 ms (bids with server time after hammer rejected with `AUCTION_CLOSED`, none after); L4 50 duplicate webhook deliveries in 1 s (one state transition). Load runs in a dedicated workflow, never on the VM.
- R-QA-031 Cross-browser matrix MUST be: desktop Chromium, Firefox, WebKit (Playwright) for the bidder, auctioneer and public views; mobile emulation iPhone 14 (WebKit), Pixel 7 (Chromium) for the bidder view. Voice capture specs run on Chromium only with a fake media device (`--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture`). Real Safari iOS is a manual check recorded in docs/QA-MANUAL.md.
- R-QA-032 A test report MUST be produced by `npm run report` on every CI run on `main` and attached to the PR as an artifact: JSON (`report/summary.json`) and a static HTML page (`report/index.html`) with counts per layer, coverage per package, scenario matrix pass/fail by mode and browser, invariant checks run, mutation score if present, the real-sandbox job's last result and date, and the commit sha. The page MUST be published to the hosted site at `/quality` on D7 for judges.
- R-QA-033 Flake policy: Playwright retries MUST be 1 in CI. A test needing the retry is recorded in `report/flakes.json`; two flakes in 7 days quarantine the test (tag `@quarantine`, excluded from required checks, issue opened automatically).
- R-QA-034 Visual regression: Playwright screenshot comparison SHOULD cover the public screen, authorization-state ladder and settlement screen at 1280x720 and 390x844 with 0.2 percent pixel tolerance; baselines are updated only by a PR labelled `visual-update`.
- R-QA-035 Test data: fixtures MUST live in `packages/e2e/fixtures/` (scenarios, audio, bids, webhook events, sandbox responses). Audio fixtures MUST be 16 kHz mono PCM WAV <= 400 KB each, with a `.json` label sidecar (section 4.4). Total fixture size MUST be < 15 MB.
- R-QA-036 Security review: a checklist (section 4.9) MUST be completed by D7 and stored as docs/SECURITY-REVIEW.md with a status per item (PASS, FAIL with issue link, N/A with reason). Every FAIL on a P0 item blocks submission.
- R-QA-037 Accessibility audit: axe-core MUST run in Playwright on every view and state listed in section 4.10 with zero `serious` or `critical` violations; keyboard-only and screen-reader labelling are checked by scripted specs; a manual pass is recorded in docs/A11Y.md by D7. Contrast MUST meet WCAG 2.2 AA (4.5:1 text, 3:1 large text and UI).
- R-QA-038 A sandbox-only guard MUST exist: the PayPal client MUST refuse any base URL other than `https://api-m.sandbox.paypal.com` and the fake server host; the e2e suite MUST assert this and a CI grep (`check:secrets`) MUST fail on the string `api-m.paypal.com` outside docs.
- R-QA-039 Secret scanning (gitleaks) MUST run on every PR and on the full history before the repo is made public, with a custom rule for `PAYPAL_CLIENT_SECRET=`, `DEEPGRAM_API_KEY=`, `GROQ_API_KEY=` patterns with non-empty values.

### 3.3 Infrastructure

- R-QA-040 Workflows (section 4.5) MUST exist as separate files under `.github/workflows/`, each with `permissions: contents: read` by default, concurrency groups that cancel superseded runs on the same ref, and a timeout per job (default 15 min, e2e 25 min, load 20 min).
- R-QA-041 CI MUST complete in under 12 minutes wall time for a typical PR by sharding Playwright 3 ways (Playwright `--shard`), caching `~/.npm` and the Playwright browser directory keyed on the lockfile, and running typecheck, lint, unit and secrets jobs concurrently.
- R-QA-042 Deploy targets: API and WebSocket room host on Render (web service, Node 22, health check `/healthz`); static web on Cloudflare Pages (or Render static, decision D-0007); Durable Object deployment ONLY if the realtime spike chooses it (otherwise single Node server on Render). Deploys MUST be triggered by workflow, not by dashboard clicks: `deploy-staging` on every merge to `main`, `deploy-prod` on a git tag `v*` or manual dispatch with a required reviewer on the `production` environment.
- R-QA-043 Environments: GitHub environments `staging`, `production`, `sandbox-nightly`. Secrets are meant to live only in environment secrets and in Render/Cloudflare dashboards; until the owner moves them (GATES.md, Sandbox environment), the PayPal sandbox secrets are repository-level and readable by a workflow on any branch, so only throwaway sandbox values may be stored; names are listed in `.env.example` with empty values. `production` and `staging` MUST both point at the PayPal sandbox; the distinction is data and URL. The server MUST fail to boot when a required variable is missing or when `PAYPAL_ENV` is not `sandbox`.
- R-QA-044 The PayPal webhook URL MUST be `https://<api-host>/webhooks/paypal`, registered in the sandbox app; the webhook id is a secret `PAYPAL_WEBHOOK_ID`, and the payments config refuses to load without it unless fake payments are on (a missing id would make every real delivery fail verification and stop PayPal retrying). A smoke job MUST confirm the route returns 400 for an unsigned POST and 200 for the health route after each deploy. The 400 is the public route status: the payments `WebhookHandler.handle` answers 401 for a failed verification (R-PAY-093) and the server route maps that to 400 (R-RT-111), so the smoke job and the handler do not disagree.
- R-QA-045 Uptime and warm-up: a scheduled workflow (every 5 min is unavailable; GitHub minimum is 5 min and may be delayed) MUST call `/healthz` and `/readyz`; an external free monitor SHOULD be configured as primary. From D8 until the judging end the room host MUST NOT sleep: use a paid always-on Render instance for the final window or a keep-alive ping every 4 min (decision D-0008). A `/warmup` route MUST pre-initialize PayPal token cache, DB connection and a demo auction in under 3 s.
- R-QA-046 Backups and export: the ledger and audit trail MUST be exportable as `GET /admin/export?auction=<id>` (NDJSON, one event per line, plus SHA-256 chain head) and a scheduled workflow MUST snapshot the production store to an artifact daily and before the freeze. Audio recordings used by replay MUST live in the repository fixtures (not only in the store).
- R-QA-047 Observability: every server log line MUST be JSON with `ts`, `level`, `msg`, `reqId`, `auctionId?`, `lotId?`, `bidId?`, `paypalRequestId?`, `state?`; no secrets or PII (emails redacted to `a***@d***.com`). Metrics exposed at `/metrics` (Prometheus text): bid ack latency histogram, accepted and rejected bids by reason, saga state transitions, PayPal call latency and status, webhook receive and dedupe counts, websocket connections. An ops page `/ops` (auctioneer token) MUST show the last 100 log lines, saga states per lot and PayPal call outcomes.
- R-QA-048 Error budget: availability target during judging window 99 percent measured by the uptime probe; any 2 consecutive probe failures MUST raise an alert (workflow annotation plus WhatsApp/Needs-you entry by the operator).
- R-QA-049 Rollback: each deploy MUST record the previous Render deploy id and image sha in the workflow summary; `deploy-prod` with input `rollback=true` MUST redeploy it. A rollback rehearsal MUST be done once before D8 (T-QA-082).

### 3.4 Submission

- R-QA-050 The video MUST be <= 2:55 on the YouTube player, public (not unlisted), 1080p, English, captioned, no copyrighted music, and labelled on screen where content is real, recorded or simulated. Script and shot list in section 4.11.
- R-QA-051 The Devpost write-up MUST follow the outline in section 4.12, name the language model and STT provider used in the product, state that sandbox money only is used, and say which parts of earlier prototype work were reused.
- R-QA-052 Screenshots (>= 6, 1920x1080 or 1600x900 PNG) per the list in section 4.13 MUST be produced by the `screenshots` workflow from a seeded demo, not hand-captured, so they are reproducible.
- R-QA-053 The repository MUST be made public only after the checklist in section 4.14 passes. LICENSE (MIT) MUST be visible in the repo root and detected by GitHub (license badge shown).
- R-QA-054 The final submission checklist (section 4.15) MUST be executed by one named person at D9 minus 6 hours and signed in docs/SUBMISSION.md with timestamps. The submit button MUST be pressed no later than 2026-11-12 04:00 PST, which leaves 8 hours of buffer before the deadline.
- R-QA-055 A judge walkthrough (docs/JUDGES.md, one page) MUST give: hosted URL, a one-click `Start demo auction` path, three sandbox buyer personas, expected outcomes per action, the `/quality` report URL and the `/audit` URL. A judge MUST be able to finish the full path in under 5 minutes without installing anything.

## 4. Interfaces

### 4.1 CODEOWNERS (path to owner)

```
# .github/CODEOWNERS  (owner handles are placeholders resolved by the orchestrator)
/packages/shared/        @gavel/realtime-owner
/packages/engine/        @gavel/engine-owner
/packages/payments/      @gavel/payments-owner
/packages/voice/         @gavel/voice-owner
/packages/server/        @gavel/realtime-owner
/packages/web/           @gavel/web-owner
/packages/e2e/           @gavel/quality-owner
/infra/                  @gavel/quality-owner
/.github/                @gavel/quality-owner
/docs/specs/SPEC-engine.md    @gavel/engine-owner
/docs/specs/SPEC-payments.md  @gavel/payments-owner
/docs/specs/SPEC-realtime.md  @gavel/realtime-owner
/docs/specs/SPEC-voice.md     @gavel/voice-owner
/docs/specs/SPEC-web.md       @gavel/web-owner
/docs/specs/SPEC-quality.md   @gavel/quality-owner
/docs/DECISIONS.md       @gavel/quality-owner
/docs/GATES.md           @gavel/payments-owner
/package.json /tsconfig.base.json /eslint.config.js   @gavel/quality-owner
```

### 4.2 Root scripts

```json
{
  "scripts": {
    "build": "tsc -b && npm run build -w @gavel/web",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint . --max-warnings 0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run --project unit",
    "test:pkg": "vitest run --project",
    "test:coverage": "vitest run --coverage --project unit && node scripts/check-coverage.mjs",
    "test:property": "vitest run --project property",
    "test:scenarios": "tsx packages/e2e/src/runner/cli.ts --mode inproc packages/e2e/scenarios",
    "test:e2e": "playwright test -c packages/e2e/playwright.config.ts --project=fake",
    "test:e2e:sandbox": "playwright test -c packages/e2e/playwright.config.ts --project=sandbox",
    "test:load": "tsx packages/e2e/src/load/run.ts",
    "report": "tsx packages/e2e/src/report/build.ts",
    "check:secrets": "gitleaks detect --redact --no-banner && node scripts/check-no-live-host.mjs",
    "check:deps": "depcruise --config .dependency-cruiser.cjs packages",
    "check:ascii": "node scripts/check-ascii.mjs",
    "check:banned-words": "node scripts/check-banned-words.mjs",
    "check:ownership": "node scripts/check-ownership.mjs"
  }
}
```

### 4.3 Scenario DSL (TypeScript; YAML mirror accepted)

```ts
// packages/e2e/src/dsl/types.ts
import type { Cents, EpochMs, Ulid, ErrorCode } from '@gavel/shared';

export type Mode = 'inproc' | 'stack';
export type Fault =
  | { at: 'paypal.capture'; kind: 'http'; status: 500 | 502 | 503 | 429; times: number }
  | { at: 'paypal.capture'; kind: 'timeout_after_commit' } // request lands, response lost
  | { at: 'paypal.void'; kind: 'http'; status: 500; times: number; bidder?: string }
  | { at: 'paypal.authorization'; kind: 'expire' | 'void_external' | 'decline'; bidder: string }
  | {
      at: 'webhook';
      kind: 'duplicate' | 'delay' | 'reorder';
      event: string;
      times?: number;
      ms?: number;
    }
  | { at: 'server'; kind: 'kill'; checkpoint: Checkpoint }
  | { at: 'stt'; kind: 'timeout' | 'garbage' | 'low_confidence'; times?: number }
  | { at: 'ws'; kind: 'drop'; client: string; forMs: number };

export type Checkpoint =
  | 'after_winner_selected'
  | 'before_capture_request'
  | 'after_capture_request_before_response'
  | 'after_capture_recorded'
  | `during_void_loop:${number}`
  | 'before_final_ledger';

export type Step =
  | { t: number; actor: string; do: 'register'; ceiling: Cents; funding?: 'wallet' | 'card' }
  | { t: number; actor: string; do: 'bid'; amount: Cents; via?: 'qr' | 'voice' | 'manual' }
  | { t: number; actor: string; do: 'say'; audio: string } // fixture id, voice replay
  | { t: number; actor: string; do: 'confirm'; accept: boolean }
  | { t: number; actor: 'auctioneer'; do: 'open' | 'pause' | 'resume' | 'extend' | 'hammer' }
  | { t: number; actor: string; do: 'disconnect' | 'reconnect' }
  | { t: number; actor: string; do: 'send_raw'; frame: string } // abusive input
  | { t: number; do: 'advance_clock'; ms: number }
  | { t: number; do: 'fault'; fault: Fault };

export type Expect =
  | { ledger: { winner: string | null; captured: Cents; released: Cents; voided: string[] } }
  | {
      settlement: Record<
        string,
        | 'HELD'
        | 'BIDDING'
        | 'WINNER_SELECTED'
        | 'CAPTURING'
        | 'CAPTURED'
        | 'VOIDING'
        | 'SETTLED'
        | 'FALLBACK_RUNNER_UP'
        | 'FAILED_NEEDS_REVIEW'
      >;
    }
  | { invariants: Array<'I1' | 'I2' | 'I3' | 'I4' | 'I5'> }
  | { rejected: Array<{ actor: string; code: ErrorCode }> }
  | { paypalCalls: { capture: number; void: number; reauthorize?: number } }
  | { ui?: { view: 'bidder' | 'auctioneer' | 'public' | 'audit'; text?: string; a11y?: true } };

export interface Scenario {
  id: string; // 'S03-crash-resume-mid-settlement'
  title: string;
  modes: Mode[];
  seed: number; // PRNG seed
  clock: { startMs: EpochMs };
  auction: {
    itemId: string;
    reserve: Cents;
    minIncrement: Cents;
    softCloseMs: number;
    mode: 'english';
  };
  actors: Record<string, { bidderId?: Ulid; funding: 'wallet' | 'card' }>;
  steps: Step[];
  expect: Expect[];
  tags?: string[]; // '@gate:G1', '@slow', '@sandbox'
}
```

Runner contract:

```ts
export interface ScenarioResult {
  id: string;
  mode: Mode;
  browser?: string;
  pass: boolean;
  durationMs: number;
  invariantsChecked: string[];
  failures: Array<{ expectIndex: number; message: string; diff?: unknown }>;
  trace?: string; // path to NDJSON event trace
}
export function runScenario(
  s: Scenario,
  mode: Mode,
  opts?: { workdir: string },
): Promise<ScenarioResult>;
```

Example (S04 duplicate webhooks, abbreviated):

```yaml
id: S04-duplicate-webhooks
title: Duplicate and delayed capture webhooks cause one transition
modes: [inproc, stack]
seed: 4
clock: { startMs: 1793750400000 }
auction: { itemId: lot-1, reserve: 5000, minIncrement: 500, softCloseMs: 0, mode: english }
actors: { ana: { funding: wallet }, ben: { funding: card } }
steps:
  - { t: 0, actor: ana, do: register, ceiling: 50000 }
  - { t: 0, actor: ben, do: register, ceiling: 25000 }
  - { t: 1000, actor: auctioneer, do: open }
  - { t: 2000, actor: ana, do: bid, amount: 6000 }
  - { t: 3000, actor: ben, do: bid, amount: 7000 }
  - {
      t: 4000,
      do: fault,
      fault: { at: webhook, kind: duplicate, event: PAYMENT.CAPTURE.COMPLETED, times: 49 },
    }
  - { t: 5000, actor: auctioneer, do: hammer }
expect:
  - ledger: { winner: ben, captured: 7000, released: 18000, voided: [ana] }
  - paypalCalls: { capture: 1, void: 1 }
  - invariants: [I1, I2, I3, I4, I5]
```

### 4.4 Fixture formats

Audio sidecar `packages/e2e/fixtures/audio/<id>.json`:

```json
{
  "id": "bid-noisy-017",
  "file": "bid-noisy-017.wav",
  "sampleRate": 16000,
  "durationMs": 3200,
  "noise": "crowd-snr-10db",
  "transcriptTruth": "three fifty for paddle twelve",
  "expected": { "kind": "bid", "amountCents": 35000, "bidder": "12", "needsConfirm": false },
  "sttFixture": "bid-noisy-017.stt.json"
}
```

`*.stt.json` holds a recorded STT result (words, timestamps, confidence) so inproc and CI runs never call a provider. Live-provider runs (gate G5) are manual or nightly and write to `docs/GATES.md`.

Webhook event fixture `packages/e2e/fixtures/webhooks/capture-completed.json`: copy of a real sandbox event with ids replaced by placeholders `{{CAPTURE_ID}}`, `{{AUTH_ID}}`; the harness fills them. Signature headers are produced by the fake verifier key, never by real PayPal keys.

### 4.5 Workflow inventory (`.github/workflows/`)

| File                 | Trigger                                | Jobs                                                                                                                                                                                   | Notes                                               |
| -------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| ci.yml               | pull_request, push main                | typecheck, lint, format-check, unit, coverage, property, scenarios, e2e-fake (3 shards x browser matrix reduced to chromium on PR), deps, secrets, ascii-banned, commitlint, ownership | required checks                                     |
| e2e-matrix.yml       | push main, manual                      | Chromium, Firefox, WebKit, iPhone 14, Pixel 7                                                                                                                                          | full matrix, uploads traces                         |
| nightly-sandbox.yml  | cron `30 20 * * *` (02:00 IST), manual | real-sandbox specs R1..R8                                                                                                                                                              | environment `sandbox-nightly`; skip without secrets |
| load.yml             | manual, push tag `v*`                  | L1..L4                                                                                                                                                                                 | uploads latency JSON                                |
| mutation.yml         | weekly, manual                         | Stryker on engine and saga                                                                                                                                                             | non-blocking                                        |
| report.yml           | workflow_run of ci on main             | build report, publish artifact and `/quality`                                                                                                                                          |                                                     |
| screenshots.yml      | manual                                 | seeded demo, Playwright captures                                                                                                                                                       | outputs `docs/submission/screenshots/` artifact     |
| deploy-staging.yml   | push main                              | build, deploy API to Render staging, web to Pages preview, smoke                                                                                                                       |                                                     |
| deploy-prod.yml      | tag `v*`, manual (rollback input)      | same, `production` environment with reviewer                                                                                                                                           |                                                     |
| uptime.yml           | schedule `*/5 * * * *`                 | probe `/healthz`, `/readyz`, `/warmup`                                                                                                                                                 | annotation on failure                               |
| backup.yml           | schedule daily, manual                 | export NDJSON, upload artifact                                                                                                                                                         |                                                     |
| gitleaks-history.yml | manual                                 | full-history scan                                                                                                                                                                      | run before going public                             |

### 4.6 Environment variables (names only, `.env.example`)

```
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
DEEPGRAM_API_KEY=
GROQ_API_KEY=
LLM_API_KEY=
DATABASE_URL=
ADMIN_TOKEN=
AUCTIONEER_TOKEN_SECRET=
PUBLIC_BASE_URL=
ALLOWED_ORIGINS=
LOG_LEVEL=info
CLOCK_MODE=real
```

Boot validation: server exits with code 78 and a single JSON log line naming the missing variable (never its value).

### 4.7 docs/DECISIONS.md format

```
# Decisions (append only; newest last)

## D-0007: Static web on Cloudflare Pages
Date: 2026-11-06
Status: accepted | superseded by D-00NN
Owner: quality
Context: one paragraph, facts only.
Decision: one sentence.
Alternatives: bullets with reason rejected.
Consequences: bullets (cost, risk, follow-up issues with keys).
Evidence: link to GATES.md block, PR or spike result.
```

Seed entries: D-0001 monorepo and npm workspaces; D-0002 review and merge rules; D-0003 integer cents and ULIDs; D-0004 fake-first interfaces; D-0005 sandbox-only guard; D-0006 realtime host (spike result); D-0007 web hosting; D-0008 keep-alive strategy; D-0009 coverage gates; D-0010 cut list triggers.

### 4.8 docs/GATES.md format

```
# Gates

## G1: partial capture and remainder release
Status: NOT RUN | PASS | PARTIAL | FAIL
Run date / by: 2026-11-04 / payments-owner
Question: after authorize 50000 and capture 35000 with final_capture=true, is the 15000 remainder released or still active?
Setup: sandbox app id (suffix only), buyer persona (wallet|card), SDK/REST version.
Requests: numbered curl-equivalent blocks, secrets and tokens redacted.
Observed: status codes, response bodies (trimmed), webhook events with timestamps.
Verdict: one line.
Decision: what the code does because of this.
Fallback if FAIL: ...
Links: PR, issue, transcript artifact.
```

Gate close rule: a gate is CLOSED only when status is PASS or FAIL with a recorded decision; PARTIAL stays open.

### 4.9 Security review checklist (OWASP-style, GAVEL specific)

| ID     | Item                                                                                                                                                            | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| SEC-01 | Broken access control: auctioneer actions (open, hammer, manual bid, extend) require a signed auctioneer token; bidder cannot call them over WS or HTTP         | P0       |
| SEC-02 | Bidder identity: join token bound to bidder id and auction; a bidder cannot bid as another; token replay after auction close rejected                           | P0       |
| SEC-03 | Webhook authenticity: PayPal signature verified with raw body; unsigned, wrong cert url host, expired timestamp all rejected; dedupe by event id                | P0       |
| SEC-04 | Secrets: none in repo or history (gitleaks), none in logs, none in client bundle (bundle grep for `PAYPAL_CLIENT_SECRET`)                                       | P0       |
| SEC-05 | Sandbox-only guard and boot validation (R-QA-038, R-QA-043)                                                                                                     | P0       |
| SEC-06 | Money integrity: amounts are integer cents server-side; client-supplied totals ignored; capture amount always from ledger; capture <= ceiling                   | P0       |
| SEC-07 | Injection: all inbound frames validated by zod; SQL via parameterised queries; no `dangerouslySetInnerHTML`; transcripts rendered as text                       | P0       |
| SEC-08 | Abusive input: frame size cap 4 KB, message rate cap 20/s per socket, bid rate cap, audio chunk cap, room size cap, join flood cap per IP                       | P1       |
| SEC-09 | CORS and origins: allowlist from `ALLOWED_ORIGINS`; WS origin checked; no wildcard with credentials                                                             | P1       |
| SEC-10 | Transport and headers: HTTPS only, HSTS, CSP (no inline script except hashed), X-Content-Type-Options, Referrer-Policy, frame-ancestors none on auctioneer view | P1       |
| SEC-11 | Audio and PII: recordings only of demo actors; no personal data stored beyond display name and masked email; export endpoint behind ADMIN_TOKEN                 | P1       |
| SEC-12 | Dependency risk: `npm audit --omit=dev` has no high or critical without a recorded waiver                                                                       | P1       |
| SEC-13 | SSRF: server never fetches user-supplied URLs; webhook cert URL host allowlist                                                                                  | P1       |
| SEC-14 | DoS on parse path: language-model call timeout 4 s, concurrency cap, fallback to manual confirm; cost cap env `LLM_MAX_CALLS_PER_MIN`                           | P1       |
| SEC-15 | Logging: no tokens, card data, client secret, full emails; reqId present                                                                                        | P2       |
| SEC-16 | Admin and ops pages: token required, rate limited, not indexed                                                                                                  | P2       |
| SEC-17 | Clickjacking and open redirect on PayPal return URL (fixed allowlist)                                                                                           | P2       |
| SEC-18 | Time: server time authoritative; client timestamps ignored for ordering                                                                                         | P0       |

### 4.10 Accessibility audit matrix

Views: bidder (join, register with ceiling presets, waiting, bidding, confirm prompt, outbid, won, lost, error), auctioneer console (live, voice feed, confirm prompt, hammer dialog, settlement), public screen (price, timer, ladder), audit view (table, filters). Checks per view: axe-core zero serious/critical; focus order logical; every control reachable and operable with keyboard; visible focus ring 2 px, 3:1; live regions announce `price` and `bid_rejected` politely and `hammer` assertively; reduced-motion respected; touch targets >= 44 px on bidder view; text resize to 200 percent without loss; colour is never the only carrier of state (ladder states have text and icon); form errors tied to inputs by `aria-describedby`.

### 4.11 Video script and shot list (target 2:50, hard limit 2:55)

| Time      | Shot                                                                                                                                              | On-screen label                                      | Voiceover (draft)                                                       | Source                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| 0:00-0:15 | Paper bid sheet, then a charity hall photo or screen recording of a spreadsheet                                                                   | none                                                 | "Every charity auction has winners who never pay."                      | stock-free: own photo or drawn graphic |
| 0:15-0:25 | Title card GAVEL, one line                                                                                                                        | none                                                 | "GAVEL makes the bid itself a PayPal hold, so the hammer is a payment." | graphic                                |
| 0:25-0:50 | Two bidders register on phones: ceiling preset, PayPal sandbox approval, copy "held, not charged"; PayPal sandbox page showing two authorizations | "Real PayPal sandbox"                                | "Each bidder approves a hold as their ceiling."                         | live capture                           |
| 0:50-1:15 | Auctioneer console and public screen: bids by QR phone and one spoken bid (20 s max)                                                              | "Live" and "Voice: recorded replay" where applicable | "Bids arrive by voice, phone or paddle. Rules are deterministic."       | live capture                           |
| 1:15-1:35 | Ambiguous utterance, confirm prompt, accepted                                                                                                     | "Language model proposes, engine decides"            | "When the bid is unclear, we ask."                                      | recorded replay, labelled              |
| 1:35-2:05 | Hammer: state ladder HELD to CAPTURED to SETTLED, webhook ticks, PayPal sandbox shows capture at winning price and others voided                  | "Real PayPal sandbox"                                | "Only the winning price is captured. Every other hold is voided."       | live capture                           |
| 2:05-2:25 | Kill the server mid-settlement, restart, ladder resumes, one capture in sandbox                                                                   | "Fault injected"                                     | "Crash mid-settlement: still exactly one charge."                       | live capture                           |
| 2:25-2:42 | Audit trail row for a spoken bid; `/quality` report page with counts                                                                              | "Counts from CI run <sha>"                           | "Every bid is auditable. Tests prove the money rules."                  | capture                                |
| 2:42-2:50 | Close card: hosted URL, repo URL, license, sandbox only                                                                                           | none                                                 | "Try it. Sandbox only."                                                 | graphic                                |

Rules: no copyrighted music (use silence or a royalty-free track with its licence recorded in docs/SUBMISSION.md); captions burned in and uploaded as SRT; no real money, no real personal data; capture at 1920x1080, 30 fps; record two full takes; export H.264; verify on YouTube as signed-out viewer that it is public and under 3:00.

### 4.12 Devpost write-up outline

1. Tagline (one line, no superlatives about being first).
2. Inspiration: the unpaid-winner problem, stated without invented statistics.
3. What it does: register with a hold, bid by voice, phone or manual entry, deterministic English auction, capture winning price only, void the rest, audit trail.
4. How PayPal is used (central): Orders v2 intent AUTHORIZE, partial capture with `final_capture`, void, `PayPal-Request-Id` idempotency, webhooks with signature verification. Mark anything UNVERIFIED until GATES.md closes it.
5. How we built it: architecture figure, packages, deterministic engine, saga and crash recovery, fake PayPal and fault injection.
6. Language model and STT: named providers; model proposes, validator and engine decide; model never moves money.
7. Challenges: authorization validity, webhook ordering, noisy audio.
8. Accomplishments: test counts and invariants from the `/quality` report; crash/resume proof.
9. What we learned.
10. What is next: real organisers pilot, reauthorization, multi-currency (not built).
11. Built with: TypeScript, React, Vite, Node, Playwright, Vitest, fast-check, Render, Cloudflare, PayPal sandbox APIs, Deepgram, named language model.
12. Try it: hosted URL, judge walkthrough, repo, video.
13. Reuse statement: logic and tests of the Python reference implementation were ported to TypeScript.

### 4.13 Screenshot list

1. Registration with ceiling presets and the "held, not charged" copy.
2. Auctioneer console mid-auction with voice feed and a confirm prompt.
3. Public screen with price, timer and bidder paddle.
4. Authorization-state ladder next to the timeline mid-settlement.
5. Settlement result: captured amount, voided holds, receipt.
6. Audit trail row expanded for a spoken bid (audio timestamp, transcript, parsed amount, confidence).
7. `/quality` report page.
8. Architecture diagram (SVG export, 1600x900).

### 4.14 Public-repo checklist

- [ ] gitleaks full history clean; `git log --all` contains no `.env` file.
- [ ] LICENSE (MIT) at root with correct year and holder; GitHub detects it.
- [ ] README: pitch, screenshot, hosted URL, quick start with `npm ci && npm run dev`, scripts, architecture, test commands, sandbox-only note.
- [ ] No internal notes: scan docs for TODO owners, personal paths, internal hostnames, private URLs; ASCII and banned-word checks green.
- [ ] `.env.example` has names only.
- [ ] Issues and PRs reviewed for sensitive content before visibility change.
- [ ] CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md present.
- [ ] Default branch protected; Actions enabled; secrets remain in environments only.
- [ ] Repo description, topics, website URL set.
- [ ] Fresh clone on a clean machine (CI job `clean-clone-check`) runs install, build and the unit tests.

### 4.15 Final submission checklist

- [ ] Hosted URL loads signed-out in a private window; demo auction starts in one click; `/healthz` 200.
- [ ] Full judge path (docs/JUDGES.md) completed once in the last 6 hours on the production URL.
- [ ] PayPal sandbox only: no live credentials, `PAYPAL_ENV=sandbox` on both environments.
- [ ] Repo public, license visible, README current, latest tag deployed.
- [ ] YouTube video public, under 3:00 on the player, captions on, signed-out check done.
- [ ] Devpost text complete; tools list; model and STT named; reuse statement; PayPal central paragraph.
- [ ] Screenshots uploaded in order; cover image set.
- [ ] Nightly sandbox job green in the last 24 hours, or documented exception.
- [ ] `/quality` report matches the numbers quoted in Devpost.
- [ ] Always-on mode enabled until judging ends.
- [ ] Submit at least 8 hours before the deadline; screenshot confirmation page; save the submission URL.

### 4.16 Report schema (`report/summary.json`)

```json
{
  "sha": "abc1234",
  "builtAt": "2026-11-09T18:00:00Z",
  "layers": {
    "unit": { "total": 612, "passed": 612 },
    "property": { "total": 41, "passed": 41, "cases": 8200 },
    "contract": { "total": 63, "passed": 63 },
    "scenario": { "total": 44, "passed": 44 },
    "e2e": { "total": 52, "passed": 52, "flaky": 0 },
    "sandbox": { "total": 8, "passed": 8, "lastRun": "2026-11-09T20:30:00Z" },
    "load": { "p95AckMs": 118, "lostBids": 0 }
  },
  "coverage": {
    "engine": { "lines": 97.1, "branches": 92.4 },
    "payments": { "lines": 93.0, "branches": 88.2 }
  },
  "scenarioMatrix": [
    { "id": "S03", "inproc": "pass", "chromium": "pass", "firefox": "pass", "webkit": "pass" }
  ],
  "invariants": { "I1": 214, "I2": 214, "I3": 214, "I4": 214, "I5": 214 },
  "mutation": { "engine": 84.0, "saga": 81.5 }
}
```

## 5. State machines and sequences

### 5.1 Pull request flow

```
 branch from main
      |
 push --> ci.yml ---------------------------------------------+
      |     typecheck | lint | unit | coverage | scenarios      |
      |     e2e-fake(3 shards) | secrets | deps | ownership     |
      |                                                         v
      |                                                  all green?
      |                                                   no |  yes
      v                                                      |   |
 fix, push <--------------------------------------------------+   v
                                                         CODEOWNER review
                                                                  |
                                                         squash merge to main
                                                                  |
                                              deploy-staging, report, e2e-matrix
```

### 5.2 Crash-resume harness

```
 harness            server (child process)          fake PayPal          store
   | start --------------> boot, load state ------------------------------> read
   | scenario steps ----> bids ...
   | hammer ------------> WINNER_SELECTED ----------------------------------> write
   |                      CAPTURING (checkpoint hit) -> POST capture --------> (recorded req id)
   |<-- checkpoint ------- SIGKILL --- (response lost or not, per checkpoint)
   | restart ------------> boot, scan non-terminal lots -> resume saga
   |                      GET capture by req id / reuse PayPal-Request-Id --> idempotent replay
   |                      VOIDING ... SETTLED -------------------------------> write
   | assert I1..I5, paypalCalls.capture == 1 (distinct effective captures)
```

### 5.3 Release and freeze

```
 D1..D7 build ->  D7 18:00 IST  feature complete candidate (tag v0.9)
 D8 12:00 IST FREEZE (only P0/bug) -> record video on tagged build
 D9 morning: final fixes -> tag v1.0 -> deploy-prod -> checklist 4.15 -> submit
 Rollback path at any time: deploy-prod rollback=true
```

## 6. Error and edge cases

| Case                                          | Required behaviour                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork PR without secrets                       | Sandbox job skipped with neutral status; fake-based jobs run normally                                                                                   |
| Real sandbox rate limit or 5xx during nightly | Retry with backoff up to 3 times then `inconclusive`, not `fail`; transcript uploaded                                                                   |
| Gate result contradicts a requirement         | The spec owner opens a DECISIONS.md entry and the tagged tests move to the stated fallback in the same PR                                               |
| Flaky Playwright test                         | One retry, recorded in flakes.json; second flake in 7 days quarantines                                                                                  |
| Coverage gate fails on a docs-only PR         | Coverage job runs only when `packages/**` changed; required check reports success when skipped via path-aware aggregator job `ci / required`            |
| Lockfile drift                                | `npm ci` fails; PR must include lockfile                                                                                                                |
| Two PRs touch `packages/shared`               | Second rebases on the first; `interface` label PRs merge in order of opening                                                                            |
| Render cold start during demo                 | `/warmup` called by the UI on landing and by uptime probe; always-on during judging                                                                     |
| PayPal sandbox outage during recording        | Record with fake PayPal in `fake` mode and label on screen "Simulated PayPal" for that segment only; keep one real-sandbox segment from an earlier take |
| Video over 3:00                               | Cut section 4.11 rows 1 and 8 first; never cut hammer or crash segments                                                                                 |
| Submission portal down at deadline            | Submit by D9 04:00 PST; save draft earlier on D8                                                                                                        |
| Secrets leaked in a PR                        | Rotate sandbox secret immediately, force-remove from history before public, record in DECISIONS.md                                                      |

## 7. Non-functional requirements

- Latency of the pipeline: `ci / unit` < 3 min, `ci / scenarios` < 2 min, `ci / e2e-fake` shard < 8 min, full CI < 12 min.
- Determinism: any failing test MUST be reproducible locally by seed and fixture (`--seed N` flag on runner and `FC_SEED` for fast-check).
- Security: least-privilege tokens (`permissions` per job), environment protection on `production`, no `pull_request_target` with checkout of fork code, third-party actions pinned by commit sha.
- Cost: all services on free tiers except an optional always-on Render instance for the judging window (budget <= 10 USD, owner approval via Needs-you board).
- Portability: every script runs on Node 22 on Linux; no OS-specific shell in package scripts.
- Reproducibility of the submission: tag `v1.0` plus `docs/SUBMISSION.md` record the exact commit deployed, video id and Devpost URL.

## 8. Test specification

### 8.1 Repo and tooling tests

- T-QA-001 (R-QA-001, R-QA-003) Clean clone, `npm ci`, run each root script with `--help`-safe smoke target; expect exit 0 for `typecheck`, `lint`, `format:check`, `test`.
- T-QA-002 (R-QA-002) Add a file in packages/engine importing `node:fs`; `check:deps` and lint MUST fail with the offending path. Add an import of `@gavel/server` from `@gavel/web`; MUST fail.
- T-QA-003 (R-QA-002) Grep test: engine sources contain no `Date.now(`, `Math.random(`, `new Date(`; MUST be zero matches.
- T-QA-004 (R-QA-006) commitlint on `feat(engine): add ledger`, accepted; on `Added stuff.`, rejected; on 80-char subject, rejected.
- T-QA-005 (R-QA-007) Script validates branch name regex `^(feat|fix|test|docs|chore|refactor|perf|ci|build)/[A-Z]{2,4}-\d{2}-[a-z0-9-]+$` and PR title prefix; fixtures: valid, missing key, wrong case.
- T-QA-006 (R-QA-008) `gh api repos/:owner/:repo/branches/main/protection` in a setup verification script returns the required contexts; mismatch fails the `infra-verify` workflow.
- T-QA-007 (R-QA-013) Ownership script given a diff touching `packages/engine/src/x.ts` under key `PAY-03` fails; under key `ENG-03` passes; with label `cross-area` passes.
- T-QA-008 (R-QA-014) Change an export in `@gavel/shared` without the `interface` label: api-extractor job fails; with label: passes.
- T-QA-009 (R-QA-015, R-QA-016) Markdown lint script parses DECISIONS.md and GATES.md against the formats; missing `Status:` line fails; GATES block without Evidence while `PASS` fails.
- T-QA-010 (R-QA-017) `check:ascii` fails on a smart quote in a md file; `check:banned-words` fails on a fixture containing a listed word and passes on clean text.
- T-QA-011 (R-QA-010, R-QA-011) Template presence test: files exist and contain the required headings.
- T-QA-012 (R-QA-005) Time the pre-commit hook on a 10-file change in CI (2 CPUs): < 5 s.

### 8.2 Test-infrastructure tests (tests of the harness)

- T-QA-020 (R-QA-022) Lint rule `no-real-time` flags `Date.now()` in a test file fixture; passes with `clock.now()`.
- T-QA-021 (R-QA-023) Property: engine, `forall bids sequence`, accepted prices strictly increase; winner equals max accepted; ties resolved by earliest `serverTimeMs` then lowest bidder id. 200 cases, seed printed.
- T-QA-022 (R-QA-023) Property: money `add(a,b)-b === a` for integer cents in [0, 10^9]; any non-integer input throws `MONEY_NOT_INTEGER`.
- T-QA-023 (R-QA-023) Property: replaying the ledger event list from empty produces a state equal to the live state (deep equal), for random event orders that are valid.
- T-QA-024 (R-QA-023, R-QA-027) Property: saga under random fault schedules (<= 6 faults from the Fault union, random kill checkpoint) satisfies I1..I5 after recovery; 300 cases.
- T-QA-025 (R-QA-023) Property: every wire message encodes and decodes to an equal value; unknown fields rejected; oversized frame (4097 bytes) rejected with `FRAME_TOO_LARGE`.
- T-QA-026 (R-QA-024) Stryker run on engine with a seeded mutant (change `>=` to `>` in increment check) is killed; score reported in summary.json.
- T-QA-027 (R-QA-025) Scenario runner: same scenario file yields identical `ledger` expectation in `inproc` and `stack`; runner returns failure with diff when an expectation is altered.
- T-QA-028 (R-QA-028) Contract: for each recorded sandbox fixture, parse with fake schemas; for each fake response in a table of 12 endpoints, parse with real-client schemas; any missing or extra field fails.
- T-QA-029 (R-QA-035) Fixture validator: every audio sidecar has `.wav` present, 16000 Hz, mono, duration within 2 percent of `durationMs`; total fixture dir < 15 MB.

### 8.3 Scenario and e2e specs

Common setup: fake PayPal server on a random port, seeded clock, three browsers per matrix. Expected values use money in cents.

- T-QA-030 S01 full auction happy path (R-QA-026). Ana (wallet, ceiling 50000) and Ben (card, ceiling 25000) register. Lot reserve 5000, increment 500. Bids: Ana 6000, Ben 6500, Ana 8000, Ben 9000, Ana 10000. Hammer. Expect winner Ana, captured 10000, released 40000, Ben voided, capture calls 1, void calls 1, final state SETTLED for both; UI public screen shows "Sold 100.00", ladder reaches SETTLED, audit view has 5 accepted rows and 0 rejected.
- T-QA-031 S02 voice replay (R-QA-026). Fixture audio `bid-clear-001` ("three hundred for paddle twelve") and `bid-ambiguous-004` ("fifty... fifteen for seven"). Expect clear utterance creates a bid of 30000 for paddle 12 without confirm; ambiguous creates `confirm_request` with two candidate amounts; `confirm_response accept=false` produces no bid; accept=true creates bid; audit row carries transcript and confidence. STT stubbed by `*.stt.json`.
- T-QA-032 S03 crash and resume (R-QA-027). Run six sub-cases, one per checkpoint. For each: kill, restart, wait up to 10 s; expect final SETTLED, I1..I5, capture requests after restart carry the same `PayPal-Request-Id` as before; for `after_capture_request_before_response` fake records exactly 1 committed capture.
- T-QA-033 S04 duplicate webhooks (R-QA-026). 50 duplicates of `PAYMENT.CAPTURE.COMPLETED` over 1 s: one transition, dedupe counter 49, audit events 1.
- T-QA-034 S05 out-of-order webhooks. Deliver `PAYMENT.AUTHORIZATION.VOIDED` for Ben before `PAYMENT.CAPTURE.COMPLETED` for Ana and a stale capture event after settle: final state identical to ordered delivery (compare deep equal of ledger).
- T-QA-035 S06 runner-up fallback. Ana's hold voided externally before capture; hammer at 10000. Expect Ana FAILED, state FALLBACK_RUNNER_UP, Ben captured at his last valid bid 9000 or at the engine-defined fallback price (value read from SPEC-engine; test reads the engine function, not a literal), Ana not charged, audit event `fallback`.
- T-QA-036 S07 and S08 winner hold voided or expired. Same as S06 with `void_external` and `expire` faults; also case where all holds invalid: lot ends FAILED_NEEDS_REVIEW with 0 captures.
- T-QA-037 S09 reconnect. Ben disconnects for 5 s during bidding, bids placed by Ana meanwhile; on reconnect Ben receives `state` with current price and last 20 events in order; Ben's pending bid sent while offline is rejected with `NOT_CONNECTED` locally and none duplicated; page shows "Reconnecting" within 1 s of drop and clears within 1 s of resume.
- T-QA-038 S10 abusive input. Frames: invalid JSON, 5 KB frame, unknown message type, bid with negative amount, 0, 1.5, 10^12, string, NaN; bid as another bidder id; 200 bids/s flood; join with expired token; transcript containing `<script>alert(1)</script>`. Expect each rejected with the right `{code, message}`, socket stays alive for non-fatal ones, flood socket throttled then closed with `RATE_LIMITED`, script text rendered inert (no dialog, text present), no state change in ledger.
- T-QA-039 S11 simultaneous bid and hammer. 20 bids in the last 100 ms plus hammer: all bids with server time < hammer time are decided, rest rejected `AUCTION_CLOSED`; winner equals max accepted; run 100 iterations with seeded jitter.
- T-QA-040 S16 sandbox-only guard (R-QA-038). Construct the PayPal client with `https://api-m.paypal.com`: throws `NOT_SANDBOX`; boot with `PAYPAL_ENV=live` exits 78; `check-no-live-host` finds the string in a temp file and fails.
- T-QA-041 S12 soft close. Bid within last `softCloseMs` extends deadline by the configured amount, never shortens; 5 extensions then hammer.
- T-QA-042 S13 capture 503 twice then success: capture attempts 3 with identical request id, final one capture committed, backoff schedule 250/500 ms (fake clock).
- T-QA-043 S14 void failure on one non-winner (500 x3) then success: void effective once per hold, `FAILED_NEEDS_REVIEW` only if retries exhausted (max 8), then manual resolve endpoint requires admin token.
- T-QA-044 S15 server restart with persisted ledger: restart in `IDLE` auction retains registered bidders, bids and price; WebSocket clients reconnect and receive `state`.
- T-QA-045 Browser matrix (R-QA-031): S01 and S09 run on Chromium, Firefox, WebKit, iPhone 14, Pixel 7 projects; all pass; screenshots stored on failure.
- T-QA-046 Visual regression (R-QA-034): baseline of public screen, ladder, settlement at two viewports; changed pixel ratio < 0.002.
- T-QA-047 Accessibility (R-QA-037): axe on all views and states in 4.10 has zero serious or critical; tab order spec: bidder register form reaches submit in <= 8 tab presses; live region receives `price` text within 200 ms of the message.
- T-QA-048 Public view as projected screen: 1920x1080, price text >= 96 px, countdown legible; assert computed font size and contrast >= 7:1.
- T-QA-049 Judge walkthrough spec: from landing page, click `Start demo auction`, register two personas, bid, hammer, view audit and `/quality`; completes in under 300 s on the fake stack; on production nightly smoke with sandbox in under 300 s.

### 8.4 Real-sandbox specs (nightly)

Tagged `@sandbox`; each uses redacted transcripts as artifacts. Where behaviour is not yet proven the spec reads `UNVERIFIED (gate Gn)` and its assertion is "record observed value", closing the gate rather than failing.

- T-QA-050 R1 authorize 500.00, capture 350.00 with `final_capture=true`; GET authorization status; assert captured equals 35000 and record whether remainder is released (observed in G1: released for wallet and card). Fallback if not released: explicit void of the remainder, assert voided.
- T-QA-051 R2 card/guest buyer AUTHORIZE flow (verified in G2 for wallet and guest card); fallback wallet buyers only; spec records which path ran.
- T-QA-052 R3 reauthorize path after simulated delay (UNVERIFIED gate G3); if sandbox cannot age authorizations, record `inconclusive` and rely on fake scenario S08.
- T-QA-053 R4 real webhook delivery to staging, signature verified (UNVERIFIED gate G4): assert event id recorded and dedupe works on a replay.
- T-QA-054 R5 idempotent capture: send same capture twice with one `PayPal-Request-Id`; assert one capture.
- T-QA-055 R6 void each non-winner exactly once; second void call returns the PayPal error that the client maps to success-already-done (record the observed error name; UNVERIFIED until run).
- T-QA-056 R7 full lot end to end through the deployed staging stack with two sandbox buyers; ledger equals PayPal GET state.
- T-QA-057 R8 reconciliation job finds zero diffs after R7.
- T-QA-058 Nightly results summary: workflow writes pass/fail/inconclusive per spec and date to `report/sandbox.json`; absent secrets produce `skipped`.
- T-QA-059 STT gate G5 harness: runs 20 labelled utterances through the live provider and the parser, writes accuracy (exact amount and bidder) and confirm rate to GATES.md block G5; target >= 90 percent exact or confirm-on-ambiguity covering the rest (UNVERIFIED gate G5).

### 8.5 Load and race

- T-QA-060 L1 100 simulated bidders at 10 bids/s for 60 s: p95 ack < 250 ms, p99 < 600 ms, 0 lost, 0 duplicated, ledger sum consistent, no server RSS growth above 150 MB.
- T-QA-061 L2 50 concurrent identical bids (same cents): exactly one `bid_accepted`, 49 `bid_rejected` with `BID_TOO_LOW` or `OUTBID`.
- T-QA-062 L3 hammer race (see S11), 500 iterations in load workflow, zero invariant violations.
- T-QA-063 L4 50 duplicate webhooks in 1 s against deployed staging: one transition; HTTP 200 for all (idempotent receipt).
- T-QA-064 Soak: 30 min auction with 20 bidders and 1 bid/s; heap stable; no unhandled rejection in logs.

### 8.6 Security tests

- T-QA-070 (SEC-01) Bidder token calls `hammer` over WS: `FORBIDDEN`; no state change. HTTP admin routes without token: 401.
- T-QA-071 (SEC-02) Token of bidder A used with bidder id B: `FORBIDDEN`. Token from auction 1 on auction 2: rejected. Token after close: rejected.
- T-QA-072 (SEC-03) Webhook route: no signature header 400; tampered body 400; valid fake-signed event 200; certificate URL host not on allowlist 400; timestamp older than 5 min 400.
- T-QA-073 (SEC-04) Bundle scan: built `packages/web/dist` contains none of the env variable names with values; log scan after S01 contains no token substring.
- T-QA-074 (SEC-07) Fuzz: 1000 random frames from fast-check arbitraries, server never throws unhandled and never changes ledger for invalid frames.
- T-QA-075 (SEC-09) Request with `Origin: https://evil.example` to WS and HTTP: rejected.
- T-QA-076 (SEC-10) Response headers on `/` include CSP, HSTS, X-Content-Type-Options, Referrer-Policy; auctioneer view has `frame-ancestors 'none'`.
- T-QA-077 (SEC-12) `npm audit --omit=dev --audit-level=high` exit 0 or waiver file listing advisory ids with expiry.
- T-QA-078 (SEC-14) Language model stub that hangs 10 s: parse path returns manual-confirm fallback within 4.2 s; call cap of `LLM_MAX_CALLS_PER_MIN` honoured with `RATE_LIMITED` on the 61st.
- T-QA-079 (SEC-18) Client sends bid with timestamp 1 hour in the past: ordering uses server time, field ignored.

### 8.7 Infrastructure and submission tests

- T-QA-080 (R-QA-043) Boot with each required variable removed in turn: exit 78 and a JSON log naming only the variable.
- T-QA-081 (R-QA-047) Log schema test: every line from S01 parses as JSON with required keys; email redaction regex finds no full emails.
- T-QA-082 (R-QA-049) Rollback rehearsal: deploy tag A, deploy tag B, run rollback; `/version` returns A's sha.
- T-QA-083 (R-QA-044) After deploy smoke: unsigned POST `/webhooks/paypal` returns 400; `/healthz` 200 with body `{ "ok": true, "sha": "<sha>" }`.
- T-QA-084 (R-QA-045) `/warmup` completes < 3 s after a 15 min idle on staging, measured by the uptime workflow, logged to report.
- T-QA-085 (R-QA-046) Export endpoint returns NDJSON whose hash chain verifies with the engine's `verifyChain`; truncated export fails verification.
- T-QA-086 (R-QA-032) Report builder: given synthetic result files produces `summary.json` valid against schema 4.16 and an HTML page with all layer counts; missing layer yields `n/a`, not a crash.
- T-QA-087 (R-QA-050) Video check script (manual with checklist): duration from YouTube page < 3:00, visibility public, captions present; result pasted in docs/SUBMISSION.md.
- T-QA-088 (R-QA-053, R-QA-039) `clean-clone-check` job: shallow clone, `npm ci`, build, unit tests; gitleaks history scan returns 0 findings.
- T-QA-089 (R-QA-054) Checklist 4.15 parser: docs/SUBMISSION.md has every box ticked with a timestamp before the `submit` job (a manual workflow) accepts running.

## 9. Open questions

| #   | Question                                                                                                        | Decision owner              | Default                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| Q1  | Is the Durable Object path chosen by the realtime spike, and does that change the deploy workflow?              | realtime owner with quality | Single Node server on Render; keep a DO deploy workflow as a stub only                    |
| Q2  | Always-on Render instance for the judging window: approve spend up to 10 USD?                                   | Project owner               | Yes from D8; otherwise 4-minute keep-alive ping                                           |
| Q3  | Is a second reviewer available, or do we self-merge after green CI with the owner's review?                     | Project owner               | Owner review required, self-merge allowed for docs only                                   |
| Q4  | Which language-model provider and STT provider are named in the Devpost text?                                   | voice owner                 | Whatever is wired at the D7 feature freeze, named exactly                                 |
| Q5  | Can PayPal sandbox authorizations be aged to test honor-period expiry (gate G3), or only simulated by the fake? | payments owner              | Simulate with fake (S07, S08); record `inconclusive` for R3                               |
| Q6  | Is Safari on a real iOS device available for the manual check?                                                  | Project owner               | WebKit emulation plus one manual check on a team phone                                    |
| Q7  | Does the video use real or recorded voice bids?                                                                 | Project owner and web owner | Recorded replay labelled on screen for noise control, one live spoken bid in a quiet room |
| Q8  | Public repo timing: make public at D8 or D9?                                                                    | Project owner               | D8 evening, after checklist 4.14, so the judges see history                               |
| Q9  | Retention of nightly transcripts as artifacts                                                                   | quality                     | 14 days, redacted                                                                         |
