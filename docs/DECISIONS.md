# Decisions (append only; newest last)

## D-0001: Monorepo with npm workspaces

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Six packages and an end-to-end package are built in parallel by separate owners and share types.
Decision: One repository with npm workspaces over the packages directory and a single lockfile.
Alternatives:

- pnpm or yarn workspaces: rejected, extra tooling for no gain at this size.
- One repository per package: rejected, cross-package changes would need coordinated releases.

Consequences:

- npm ci is the only install command in CI.
- Dependency direction is enforced by lint and dependency rules (QA-03).

Evidence: SPEC-quality R-QA-001, R-QA-018.

## D-0002: Review and merge rules

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Several owners edit the repository at once and main must stay releasable.
Decision: Pull request required, squash merge only, CODEOWNER review, with self-merge after green CI allowed for docs-only changes.
Alternatives:

- Direct pushes to main: rejected, no review trail.
- Merge commits: rejected, history is not linear.

Consequences:

- Branch protection lists the ci / required check.
- Cross-area changes need the cross-area label.

Evidence: SPEC-quality R-QA-008, R-QA-009, R-QA-013.

## D-0003: Integer cents and ULIDs

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Money must never be subject to floating point error and identifiers must sort by creation time.
Decision: All amounts are integer cents and all identifiers are ULIDs.
Alternatives:

- Decimal strings: rejected, easy to mix with numbers.
- UUIDv4: rejected, not sortable.

Consequences:

- A lint rule and property tests cover money arithmetic.

Evidence: SPEC-quality R-QA-023.

## D-0004: Fake-first interfaces

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Consumers must build against payments and voice before the real integrations are verified.
Decision: Each module publishes types, a fake and fixtures before any consumer depends on the real implementation.
Alternatives:

- Build against the live sandbox from day one: rejected, blocks parallel work on credentials and network.

Consequences:

- Contract tests keep the fake and recorded real responses in agreement.

Evidence: SPEC-quality R-QA-014, R-QA-028.

## D-0005: Sandbox-only guard

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The product handles payment holds and must never reach the live payment host.
Decision: The payment client refuses any base URL except the sandbox host and the fake server host, and CI fails on the live host string.
Alternatives:

- Rely on environment variables alone: rejected, a wrong value would go unnoticed.

Consequences:

- The server refuses to boot when PAYPAL_ENV is not sandbox.

Evidence: SPEC-quality R-QA-038, R-QA-043.

## D-0006: Realtime host

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The room host choice depends on the realtime spike result, which is not available yet.
Decision: Default to a single Node server on Render until the realtime spike reports otherwise.
Alternatives:

- Durable Objects: deferred, only adopted if the spike chooses them.

Consequences:

- Superseded by a new entry if the spike chooses another host.

Evidence: SPEC-quality R-QA-042.

## D-0007: Web hosting

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The web package builds to static files.
Decision: Host the static web build on Cloudflare Pages.
Alternatives:

- Render static site: kept as the fallback if Pages setup blocks the deploy workflow.

Consequences:

- Deploys run from workflows, not dashboard clicks.

Evidence: SPEC-quality R-QA-042.

## D-0008: Keep-alive strategy

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Free instances sleep and a cold start during judging would hurt the demo.
Decision: Use a keep-alive ping every 4 minutes and a warmup route, moving to an always-on instance for the final window if needed.
Alternatives:

- Always-on instance from the start: rejected, avoidable cost.

Consequences:

- An uptime workflow probes the health routes.

Evidence: SPEC-quality R-QA-045.

## D-0009: Coverage gates

Date: 2026-11-04
Status: accepted
Owner: quality
Context: Money-handling code needs stricter coverage than presentation code.
Decision: Enforce per-package line and branch coverage gates and never lower them without a new entry here.
Alternatives:

- One global threshold: rejected, it hides weak spots in the engine and payments.

Consequences:

- Gates are checked by the coverage job in CI.

Evidence: SPEC-quality R-QA-021.

## D-0010: Cut list triggers

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The deadline is fixed and scope must shrink before quality does.
Decision: Cut scope in a fixed order when a trigger is hit, and record each cut as a new entry.
Alternatives:

- Decide ad hoc at the deadline: rejected, decisions made late are worse.

Consequences:

- From the freeze only fixes labelled priority:P0 or type:bug merge.

Evidence: SPEC-quality section 2 (Freeze), MASTER-PLAN.

## D-0011: Engine coverage threshold set to measured baseline

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The engine gate was advisory, so it never failed. Measured on main it is 93.5 percent lines and 87.7 percent branches, below the 95 and 90 targets in SPEC-quality R-QA-021.
Decision: Make the engine gate enforcing at 93 percent lines and 87 percent branches (coverage threshold lowered from the advisory 95 and 90), and raise it back to 95 and 90 as the engine package adds the missing tests.
Alternatives:

- Keep 95 and 90 enforcing: rejected, it blocks every merge until the engine tests land.
- Keep the gate advisory: rejected, a deleted test file would go unnoticed.

Consequences:

- The ratchet in CI only allows this value to go up from here.

Evidence: scripts/check-coverage.mjs, SPEC-quality R-QA-021.

## D-0012: Durable write order for the ledger, the room log and the settlement journal

Date: 2026-11-04
Status: accepted
Owner: quality
Context: A restart must not leave the payments journal and holds pointing at a lot the engine ledger no longer knows. Three records are written by three stores: the engine ledger (LedgerStore), the room event log (RoomStore) and the payments journal (JournalStore, held in RoomStore slots).
Decision: The engine ledger is the source of truth and is written first. The room log is derived from ledger entries and may lag; on start it is rebuilt from the ledger. The payments journal for a lot is created only after LOT_HAMMERED is in the ledger, and the bridge sends RecordSettlement and CompleteLot only after the journal step they describe is saved. A file-backed ledger and room store (one JSON line per batch, synced before the call returns, torn tail dropped on start) back the single-host crash scenarios; Postgres and D1 adapters must pass the same contract suites.
Alternatives:

- Room log as source of truth: rejected, the engine replays and verifies the hash chain from its own ledger.
- One transaction across all three: rejected, the stores are separate and PayPal calls sit between them.

Consequences:

- A crash between the ledger append and the journal create leaves a hammered lot with no settlement; the runner creates it on resume.
- A crash after a capture and before CompleteLot is repaired by the bridge, which reads the engine first and sends only what is missing.

Evidence: SPEC-quality R-QA-027, SPEC-realtime R-RT-093, SPEC-engine R-ENG-076 and R-ENG-104, packages/server/src/store.

## D-0013: Terminal settlement state of a DONE lot is derived, not commanded

Date: 2026-11-04
Status: accepted
Owner: engine
Context: R-ENG-068 says a DONE lot accepts no settlement command, but CompleteLot makes the lot DONE, so a captured lot could never record SETTLED and a lot left unsold by a promotion could never record VOIDING. The ledger then ended with a settlement state that disagreed with payments (ENG-R2-11).
Decision: RecordSettlement stays limited to SETTLING lots, so R-ENG-068 holds without exception. The reducer sets the terminal state instead: LOT_SETTLED moves lot.settlement to SETTLED, and LOT_UNSOLD moves it to VOIDING when the lot was SETTLING (a hammered lot that lost its last candidate and released its hold). A lot unsold without a hammer (no bids) keeps HELD, since nothing was held. The bridge keeps sending RecordSettlement for the steps in between and CompleteLot last.
Alternatives:

- Allow RecordSettlement on DONE lots: rejected, it contradicts R-ENG-068 and opens the ledger to late writes after the lot closed.
- A new terminal command: rejected, the two terminal states follow from events that already exist.

Consequences:

- lot.settlement is final the moment the lot is DONE, and replay reproduces it from the same entries.
- No new event type and no change to ledger hashes.

Evidence: SPEC-engine R-ENG-067, R-ENG-068, packages/engine/src/evolve.ts, packages/engine/test/settlement.test.ts.
