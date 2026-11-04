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

## D-0014: Accepted bids reach the engine ledger before they are acknowledged

Date: 2026-11-04
Status: accepted
Owner: server
Context: D-0012 says the ledger is written first, but the service replayed the room's command list into the engine runtime once, at the hammer. A crash during an open lot left no hash-chained ledger at all (ENG-R3-03, SERVICE-R3-15).
Decision: The room log stays the first durable record of a room event, because the room engine decides a bid synchronously and the log append is what makes it final. Straight after the append, and before the sender gets bid_accepted (or registered, or a revoke takes effect), the room calls a host hook and the service writes the new engine commands to the ledger, one writer per auction, in order. The ledger therefore never lags an acknowledgement: the sender hears nothing until the ledger holds the bid. If the ledger write fails, the event stays committed in the room log, the sender gets store_unavailable, and a retry of the same message id is answered with the original reply only after the ledger has caught up. Command ids come from the command content, so repeating a write after a crash is a duplicate and appends nothing. The hammer still flushes whatever is missing before the settlement starts, so a restart converges to the same ledger. Rejected bids stay in the room log only (their bid_rejected event carries the audit record); the engine ledger holds no entry for them and the room engine does not replay them.
Alternatives:

- Ledger append first, then the room log: rejected, a failed log append would leave a ledger entry the rebuilt room does not have, and the retry would produce a different command.
- Keep the hammer-time batch and correct the text: rejected, it leaves the live auction without any tamper evidence until the end.

Consequences:

- D-0012 stays true for the order the settlement relies on (ledger holds LOT_HAMMERED before the journal exists); the room log is not derived from the ledger, and a lost room log is not rebuilt from it.
- Every accepted bid costs one ledger append before its acknowledgement.

Evidence: packages/server/src/runtime/auction-service.ts (flushLedger), packages/server/src/room/room.ts (makeDurable), SPEC-engine R-ENG-076, SPEC-quality R-QA-027.

## D-0015: The kill switch cancels an open auction through an unsold hammer and AbortLot

Date: 2026-11-04
Status: accepted
Owner: server
Context: Nothing sent the engine AbortLot, so an engaged kill switch only stopped captures after the hammer and the room kept taking bids with live holds (ENG-R3-02).
Decision: The service gets abortOpenLots(). While the kill switch is engaged it asks every room that has not been hammered to abort. The room appends a control record (id abort:<auction>, args abort 1) and a hammered event with no winner, which makes the room an ordinary unsold auction: the engine applies AbortLot (reason kill_switch), the ledger flush sends it after every bid, and the existing settlement voids every hold and reports to the room. No capture is attempted, so the kill switch does not hold the run back, and voids are not blocked by it. The host calls abortOpenLots when it engages the switch; resume() calls it too, so a restart or the periodic timer completes an interrupted abort. A room replays the control record to reproduce the abort instead of a normal hammer. The saga's own cancel transition (HELD or BIDDING to VOIDING) is not used; the no-candidate path ends in the same VOIDING state.
Alternatives:

- A new room event type for the abort: rejected, the control record and the hammered event already carry what replay needs, so the wire and log contracts stay as they are.
- Void the holds and leave the room open: rejected, the room would keep accepting bids nobody can pay.

Consequences:

- A hammer that fires between the engage and the abortOpenLots call settles normally and waits on the kill switch as before.
- The abort is final; releasing the kill switch does not reopen the auction.

Evidence: packages/server/src/runtime/auction-service.ts (abortOpenLots), packages/server/src/room/room.ts (abort), packages/engine/src/decide/abort-lot.ts, R-PAY-037.

## D-0016: A revoked hold drops the bidder's ceiling in the room before the hammer

Date: 2026-11-04
Status: accepted
Owner: server
Context: A leader whose hold was voided or denied mid-auction stayed leader until settlement, and the revoke was lost if the process died between saving the hold and telling the engine (SERVICE-R3-11).
Decision: onHoldStatus sends a hold that can no longer be charged to the room, which appends a ceiling_revoked event, applies the revoke to the room engine (striking the bidder's bids) and broadcasts the new price, then writes the ledger. The event type is new in the shared room event schema. A bidder who is not on the roster or is already revoked is a no-op that still flushes the ledger. After the hammer the settlement bridge delivers the revoke as before, and a time_regression from a concurrent settlement command is retried instead of dropped. The webhook intake already calls onHoldStatus again for an event whose hold is no longer HELD and is not yet marked processed, so a crash between saving the hold and the revoke repeats the revoke from the sweep.
Alternatives:

- Re-derive revokes from the hold store when a room loads: rejected, a rebuilt room would apply them at the end of the log instead of where they happened.

Consequences:

- Older logs have no ceiling_revoked events and replay unchanged.

Evidence: packages/server/src/runtime/auction-service.ts (onHoldStatus), packages/server/src/room/room.ts (revokeBidder), R-ENG-044.

## D-0017: Bridge commands use content-derived ids

Date: 2026-11-04
Status: accepted
Owner: server
Context: The settlement bridge sent every ledger command with a fresh random id, so exactly-once recovery by command id protected nothing and two overlapping drivers could both pass the read-first checks and then fail each other (ENG-R3-13).
Decision: The service derives the id of CompleteLot, RecordSettlement, PromoteRunnerUp, RevokeCeiling and CloseAuction from the command content (lot, bidder, ref or disqualified bidder). A second driver sending the same step gets a duplicate from the engine, which ignores the time of a repeat. This lives in the service's dispatch wrapper; the bridge, the adapter and every public contract are unchanged.
Alternatives:

- Change the adapter to take content-derived ids: rejected, it changes the payments adapter contract.

Consequences:

- finishBridge needs no special handling of lot_done and state_continuity for a repeat of the same step.

Evidence: packages/server/src/runtime/auction-service.ts (contentCommandId), SPEC-engine R-ENG-087.

## D-0018: The hosted demo keeps its file stores on a persistent disk, one instance

Date: 2026-11-04
Status: accepted
Owner: quality
Context: The room log, ledger, journals, holds and webhook events are files, and each file belongs to one process with no cross-process lock. A Render web service has an ephemeral disk, so a redeploy would lose every record while the sandbox authorizations still exist at PayPal, and a rolling deploy starts the new instance before the old one stops, so two writers could share one snapshot (INT-R3-16).
Decision: Deploy with a persistent disk mounted at /var/data and numInstances 1, both set in render.yaml. The host reads the data directory from GAVEL_DATA_DIR and every file store lives under it. Deploys must stop the old instance before the new one starts (Render: disable zero-downtime deploys for this service). Back the disk up with a snapshot before a deploy that changes a store format.
Alternatives:

- Postgres or D1 for every store: deferred, it is a larger change than the demo needs.
- A lock file taken at start-up: wanted as a second guard; tracked as a follow-up in packages/server because the host entry point is not built yet.

Consequences:

- The host entry point must create its stores under GAVEL_DATA_DIR and refuse to start when that directory is missing in hosted mode.
- The crash and resume segment of the demo works on the hosted URL because journals survive a restart.

Evidence: docs/PLAN.md (Store), packages/payments/src/stores/file.ts header, SPEC-quality R-QA-042.
