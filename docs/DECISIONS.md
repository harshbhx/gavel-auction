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
Decision: Amended by D-0029 for the order of the first two writes. The engine ledger is the source of truth for the hash chain and is written first. The room log is derived from ledger entries and may lag; on start it is rebuilt from the ledger. The payments journal for a lot is created only after LOT_HAMMERED is in the ledger, and the bridge sends RecordSettlement and CompleteLot only after the journal step they describe is saved. A file-backed ledger and room store (one JSON line per batch, synced before the call returns, torn tail dropped on start) back the single-host crash scenarios; Postgres and D1 adapters must pass the same contract suites.
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
Decision: Deploy with a persistent disk mounted at /var/data and numInstances 1, both set in render.yaml. The host reads the data directory from DATA_DIR (with STORE=file) and every file store lives under it. Deploys must stop the old instance before the new one starts (Render: disable zero-downtime deploys for this service). Back the disk up with a snapshot before a deploy that changes a store format.
Alternatives:

- Postgres or D1 for every store: deferred, it is a larger change than the demo needs.
- A lock file taken at start-up: wanted as a second guard; tracked as a follow-up in packages/server because the host entry point is not built yet.

Consequences:

- The host entry point must create its stores under DATA_DIR and refuse to start when that directory is missing in hosted mode.
- The crash and resume segment of the demo works on the hosted URL because journals survive a restart.

Evidence: docs/PLAN.md (Store), packages/payments/src/stores/file.ts header, SPEC-quality R-QA-042.

## D-0019: The verify-ledger CLI bundles the TypeScript verifier with esbuild at run time

Date: 2026-11-04
Status: accepted
Owner: engine
Context: `verify-ledger` is a plain Node script that must run the same verifier the engine ships, which is TypeScript with `.js` import specifiers. Node's built-in type stripping does not rewrite those specifiers, and the repository has no build step for the engine.
Decision: `bin/verify-ledger.mjs` bundles `src/ledger/export.ts` in memory with esbuild on each run and imports the result. esbuild is already in the lockfile through vitest; it is now a pinned dev dependency of `@gavel/engine`, and the browser bundle check uses it too. No compiled output is committed and the package keeps no runtime dependency.
Alternatives:

- tsx as a dev dependency: rejected, a second TypeScript loader for one script.
- A committed compiled script: rejected, it can drift from the source verifier.
- Reimplement the verifier in plain JavaScript: rejected, two implementations of the hash chain.

Consequences:

- The CLI needs dev dependencies installed (a repository checkout, not a published package).
- Each run pays a few milliseconds for the bundle.

Evidence: packages/engine/bin/verify-ledger.mjs, SPEC-engine R-ENG-078, R-ENG-120.

## D-0020: Privacy by a redacted public chain, not by hashing private fields

Date: 2026-11-04
Status: accepted
Owner: engine
Context: Ledger entries carry ceilings, hold references, leader and rank, and bid amounts on sealed lots in plaintext, and the entry hash covers them. A redacted export cannot pass the v1 chain check, and an unredacted export leaks how high a rival can go (ENG-RT-12).
Decision: The private ledger, its v1 entries and its hash vector do not change. A public export is a second chain (version 2) over redacted copies: ceilingCents, fromCents, holdRef, leader and rank fields, availableCeilingCents, and the amounts of a sealed lot before its hammer are removed, and each public entry records the names it dropped and the hash of the private entry it came from. The public chain is verified on its own; an auditor with the private ledger confirms the export with matchesLedger.
Alternatives:

- Salted digests of private fields inside the entry: rejected, it changes the hash vector and every golden fixture, and an unsalted digest of a small number can be guessed.
- Stop writing the private fields: rejected, settlement and audit need them.

Consequences:

- The golden fixtures and hash vector are unchanged; no version bump of the private ledger.
- The public chain proves order and integrity of what is shown, and binds to the private ledger through fullHash; it does not let a viewer check the hidden values.
- A lot added without an explicit mode in LOT_ADDED is treated as not sealed.

Evidence: packages/engine/src/ledger/public-export.ts, packages/engine/test/public-export.test.ts, SPEC-engine R-ENG-045, R-ENG-086, R-ENG-108, R-ENG-109.

## D-0021: Public export no longer publishes private entry hashes (version 3)

Date: 2026-11-04
Status: accepted
Owner: engine
Context: Version 2 of the public export carried `fullHash`, the hash of the private entry, on every entry. For a sealed bid or a ceiling entry the only private input left was a small integer, so anyone could hash each candidate amount against the published value and recover it (R5-E01). The export also kept the spoken transcript of sealed bids and the bid amount of proxy lots, which is the bidder's secret maximum (R5-E02, R5-E03).
Decision: The public export is version 3. An entry that had fields removed carries `fullHash` null, or a keyed commitment (hash over the secret `commitKey` and the private hash) when the auditor passes a key to `publicExport`. An entry that lost nothing keeps the private hash. Sealed lots also lose `audit.transcript`; proxy lots lose `amountCents`, `amountRaw` and `audit.transcript` until the hammer, and keep the price fields. `matchesLedger` verifies the private chain and compares each public entry byte for byte with the re-derived one, with the same key. `verifyPublicExport` and the `verify-ledger` command take an expected head and report a truncated export; the command rejects an empty file unless `--allow-empty` is given.
Alternatives:

- Salted commitment with a per-entry random salt: rejected, the export would no longer be reproducible from the ledger.
- Keep proxy maxima public: rejected, the public projection shows only the price and SPEC R-ENG-109 says no viewer sees a maximum.

Consequences:

- Public export version 2 files no longer verify (`bad_version`); regenerate them. The private ledger, its golden fixtures and hash vector are unchanged.
- Without a key the public chain no longer binds redacted entries to a private hash; the auditor re-derives the whole export from the ledger instead.

Evidence: packages/engine/src/ledger/public-export.ts, packages/engine/bin/verify-ledger.mjs, packages/engine/test/public-export.test.ts, SPEC-engine R-ENG-045, R-ENG-078, R-ENG-086, R-ENG-109.

## D-0022: One lot per auction room; the ledger is the audit log

Date: 2026-11-04
Status: accepted
Owner: server
Context: The engine accepts many lots and a hold scope of lot or event, but the settlement journal, the hold store and the room are keyed by auction id with one candidate per bidder and one capture per hold. A second hammer in the same auction would be refused as a different plan (INTEGRATION-RT-08). The room log and the engine ledger are also two records of the same events (INTEGRATION-RT-10).
Decision: A room runs exactly one lot. The server creates the lot with the room's auction id as lot id (lotIdOf), so the settlement journal key, the hold key and the lot id are the same value, and no server route adds a second lot. Multi-lot events are out of scope until journals and holds are keyed by auction and lot and a multi-win capture amount is defined. For the logs, D-0014 is the current rule (D-0012 is amended by D-0029): the engine ledger is the hash-chained audit record and the source for the public export and verification (D-0020, D-0021); the room log is the first durable record of a room event and the replay source for a room; rejected bids, voice and confirm records live in the room log only.
Alternatives:

- Key journals and holds by auction and lot now: rejected, the demo is single lot and the change reaches payments, the store contract and the web settlement screen.
- Persist only ledger entries and derive the room log: rejected in D-0014, a failed log append would leave ledger entries the rebuilt room does not have.

Consequences:

- A second lot in one auction is not a supported product path.
- The audit export a judge verifies comes from the ledger, never from the room log.

Evidence: packages/server/src/runtime/ledger-engine.ts (lotIdOf), packages/payments/src/saga/plan.ts, packages/engine/src/ledger/public-export.ts, SPEC-engine R-ENG-013, R-ENG-043, R-ENG-070, R-PAY-044.

## D-0023: No ceiling raises in the demo; the first hold decides

Date: 2026-11-04
Status: accepted
Owner: server
Context: A bidder can ask for a second hold while the first is still live, and the room could register that second hold as a ceiling raise. The engine supports `CEILING_RAISED`, but a raise would change payments, the room and the web copy together, and the demo does not need it.
Decision: A bidder has one hold per auction and cannot raise it. Payments answers a second hold request for a bidder with a live hold with 409 `hold_exists`. If a second authorization is approved anyway (a lapsed order approved late), the room keeps the first registration: `registerBidder` for a bidder already on the roster is a no-op that appends no event, the engine never receives a raise, and the plan uses the first hold. The settlement service voids the unused second authorization as a spare. The engine keeps its `CEILING_RAISED` support for later, but nothing in the server reaches it.
Alternatives:

- Supersede the old hold: payments would void the first hold only after the second is HELD, the room would append a ceiling_raised event and call the engine, and the plan would use the latest hold. Rejected for now: three components change together and the demo does not need it.
- Reject a repeat registration with an error: rejected, a retry of the same registration must stay harmless.

Consequences:

- A bidder who wants a higher ceiling joins again as a new bidder or the auctioneer starts a new lot; the web copy must not offer a raise.
- Reopening this needs the supersede flow above, with a regression test per component.

Evidence: packages/payments/src/holds/service.ts (hold_exists), packages/server/src/room/room.ts (registerBidder), packages/server/src/runtime/auction-service.ts (heldRefs), packages/server/test/room.test.ts, R-ENG-040, R-RT-054, R-PAY-031.

## D-0024: /metrics needs the admin key and is rate limited

Date: 2026-11-05
Status: accepted
Owner: server
Context: `GET /metrics` answered anyone with connection counts, bid volume, latency and webhook and rate-limit counters, which tells an attacker when a flood takes effect.
Decision: `/metrics` stays on the public listener but requires the `x-admin-key` header (the same constant-time check as `/ops/rooms`), answers 401 without it, and answers 429 with `retry-after` past 60 requests per minute for the whole route. Webhook outcomes, bids, rejected bids and rate limit hits are fed into the collector from the webhook guard and the room.
Alternatives:

- A separate internal listener: rejected, the host has one port and no private network on the demo deployment.

Consequences:

- A scraper must send the admin key; unauthenticated probes see 401 only.

Evidence: packages/server/src/http/metrics.ts, packages/server/test/metrics.test.ts, R-RT-135, R-RT-137.

## D-0025: Pause, resume and extend are engine commands; ceiling policy lives in shared

Date: 2026-11-05
Status: accepted
Owner: engine
Context: The shared control events and the web console offer pause, resume and extend, but the engine had no command behind them, so a pause could not keep the time left and an extension had nothing to call (INTEGRATION-RT-18). Separately the ceiling presets, minimum and cap were three independent copies (INTEGRATION-RT-04).
Decision: The engine gains `PauseLot`, `ResumeLot` and `ExtendLot` with ledger events `LOT_PAUSED`, `LOT_RESUMED` and `LOT_EXTENDED` (22 event types). Pause records the time left; Tick does nothing and bids are rejected as `lot_not_open` (detail `paused: true`) while paused; resume sets the deadline to the resume time plus the time left. Extend adds 1 to 600000 ms to a running lot, does not use up a soft-close extension, and is refused while paused. A paused lot cannot be hammered early, but it can still be aborted. `pausedRemainingMs` exists on a lot only while it is paused, so unpaused lots keep the same state digest. The ceiling presets, minimum and default cap are defined in `@gavel/shared` (`ceilings.ts`); engine and payments keep matching copies because neither may depend on shared, and `packages/server/test/ceiling-policy.test.ts` fails when any copy drifts.
Alternatives:

- Add `PAUSED` to the lot status: rejected, it changes every status switch and the state digest of existing ledgers.
- Reuse `END_EXTENDED` for admin extension: rejected, that event is tied to a trigger bid and the soft-close counter.
- Make payments and engine import the shared constants: rejected, both packages keep a tiny dependency set.

Consequences:

- The room and web console can map pause, resume and extend control actions onto the new commands; wiring them is a follow-up outside this change.
- A hold created for a ceiling the engine later refuses is still not voided by the room; that part of INTEGRATION-RT-04 stays open.

Evidence: packages/engine/src/decide/pause.ts, packages/engine/test/pause-lot.test.ts, packages/shared/src/ceilings.ts, packages/server/test/ceiling-policy.test.ts, R-RT-048, R-RT-049, R-ENG-014, R-ENG-040, R-PAY-031.

## D-0026: Engine hardening from review round 8

Date: 2026-11-05
Status: accepted
Owner: engine
Context: Review round 8 found that a promotion could follow the capture, that its retry could conflict, that the public hammer entry exposed proxy maxima, that a raise on a revoked bidder was a silent no-op, and that one account could fill a lot's bid cap (R8-E01 to R8-E05).
Decision: PromoteRunnerUp is refused with `state_continuity` while the settlement is CAPTURED, or VOIDING after a capture (SETTLED stays allowed because the settlement bridge replays a whole history before promoting to the bidder it charged),. The fallback settlement step a promotion injects is remembered as part of PromoteRunnerUp. The public export drops `ranking[].amountCents` from the hammer entry of a proxy lot. A raise on a revoked record is refused with `bad_command`. `LIMITS` gains `bidsPerBidderPerLot` (2000) and `bidsReservedForLead` (1000): one bidder may record at most 2000 bids on a lot, and the last 1000 slots of the lot cap only take a bid that takes the lead.
Alternatives:

- Clear `revoked` on a raise: rejected, re-authorisation needs a spec change and an explicit event.
- Require a minimum step for proxy raises: rejected, it changes the price rules; the per-bidder cap bounds the abuse.

Consequences:

- A bidder who reaches the per-bidder cap on a lot gets `limit_exceeded` for further bids on that lot.
- Public proxy exports no longer show each bidder's final maximum.

Evidence: packages/engine/test/round8-engine.test.ts, R8-E01, R8-E02, R8-E03, R8-E04, R8-E05.

## D-0027: A soft-close trigger that leaves the end unchanged is not an extension

Date: 2026-11-05
Status: accepted
Owner: engine
Context: The weekly rotating-seed differential run (seed 1988800899, scenario 666, field endsAt) found the TypeScript engine and the Python reference disagreeing. A late bid inside the window with `at + extensionMs` below the current `endsAt` leaves the end unchanged. The reference still incremented `extensions`, so it refused the next real extension; the engine counted only changed ends. R-ENG-034 says to increment `extensions` but R-ENG-038 and R-ENG-036 speak of an extension as something that moves the end.
Decision: An extension happens only when `endsAt` strictly increases. A bid that triggers the window without moving the end emits no END_EXTENDED and does not consume maxExtensions. The engine already behaved this way (`extension()` returns `extended: false`); the Python reference is fixed to match, and the scenario is pinned in packages/engine/test/differential.test.ts.
Alternatives:

- Count the no-op trigger and emit END_EXTENDED with equal before and after: rejected, it changes the public event stream and wastes the extension budget on a bid that extended nothing.

Consequences:

- The reference and the engine agree on endsAt for any number of late bids under maxExtensions.

Evidence: packages/engine/test/differential.test.ts (seed 1988800899, scenario 666), reference/python/test_engine.py.

## D-0028: The room host stays Node; no Durable Object host is built

Date: 2026-11-05
Status: accepted
Owner: realtime
Context: R-RT-141 asks for a Durable Object versus Node comparison. R-RT-142 makes Node the default and lets a Durable Object win only by passing every row of the decision table. The spike (RT-86) ran no Durable Object room, so every Durable Object row is unmeasured.
Decision: Keep the Node host (D-0006 stands). No Durable Object host is built. The evidence and the missing half are in packages/server/spike/HOST-DECISION.md.
Shipped path: the Node host is the only host that ships and the one every test, deploy and demo uses. The Durable Object side of the spike was not built, so it is neither a fallback nor a supported target.
Alternatives:

- Durable Object host: not chosen, no evidence on latency, recovery, storage, deploy time or free-plan limits.

Consequences:

- T-RT-098 is only partly satisfied: Node harnesses exist, the Durable Object side was not built.
- The room code has no node: imports, so a later Durable Object host stays possible; reopen with a new decision ID if the revisit conditions in the spike document are met.

Evidence: SPEC-realtime section 5.6, R-RT-140 to R-RT-143, D-0006, D-0018, packages/server/spike/HOST-DECISION.md.

## D-0029: The room log is written first; D-0012 is amended for the log order

Date: 2026-11-05
Status: accepted
Owner: quality
Context: D-0012 says the ledger is written first and the room log is rebuilt from it. D-0014 says the opposite in its decision text, D-0022 says both stand, and the code follows D-0014: room.ts replays only from the room store, the ledger is flushed after the room append and before the acknowledgement, and a rejected bid is never committed to the ledger (ledger-engine.ts run(), placeBidWith). DEMO.md and R-ENG-031 also described a BID_REJECTED ledger entry that the server does not write.
Decision: The room log is the first durable record of a room event and the replay source of a room. The engine ledger follows it before the sender is acknowledged and is the hash-chained audit record for accepted bids, registrations, revocations and the hammer. A lost room log is not rebuilt from the ledger. Rejected bids live in the room log only and are not in the ledger. From D-0012 only the settlement order still stands: LOT_HAMMERED is in the ledger before the journal exists. R-ENG-031 holds for the engine core; the server runtime does not commit rejections to its ledger.
Alternatives:

- Write rejected bids to the ledger: rejected, a rebuilt room has no replay step for them, so the two records would differ.
- Rebuild the room log from the ledger as D-0012 says: rejected, the ledger lacks rejected bids and confirmations.

Consequences:

- D-0012 is read together with this record; where they differ, this record and D-0014 win.
- The public ledger export cannot show rejected bids; the room log audit screen does.

Evidence: packages/server/src/runtime/ledger-engine.ts, packages/server/test/ledger-engine-contract.test.ts, R6-D03, R6-D04.

## D-0030: The Python reference covers promote, revoke, abort, pause, resume and extend

Date: 2026-11-05
Status: accepted
Owner: engine
Context: The differential test (R-ENG-114) and the parity fixtures (R-ENG-112, R-ENG-113) only covered register, bid, tick and hammer, so the reference had no promote, revoke, abort or pause commands and the engine's fallback, strike and clock rules were checked against hand-derived fixtures only (issue #1443). Some behaviour the reference now needs is not spelled out: R-ENG-055 and R-ENG-057 do not say whether a skipped candidate counts toward the fallback depth, and D-0025 does not say what the deadline is after a pause that never resumes.
Decision: `reference/python/engine.py` gains `revoke`, `abort`, `promote`, `pause`, `resume` and `extend`, and the fixture ops `pause`, `resume` and `extend` exist (`amount` of an extend step is the added time in ms). The reference follows the engine on every point below, and the differential generator draws these commands in about half of its scenarios.

- A revoke before the hammer strikes the bidder's bids; after the hammer only the flag is set. An unknown bidder is refused `bad_command`; a repeated revoke is a no-op.
- A hammer with no bids, an abort, and a promotion with no candidate left all end the lot DONE with no winner (winner null, price 0). A DONE lot answers bids, hammer, promote, pause, resume, extend and abort with `lot_done`; a hammered lot answers abort, pause, resume and extend with `lot_frozen`.
- A promotion removes the disqualified, demoted and skipped bidders, prices each remaining candidate over the bids that are left, and counts a skipped candidate (revoked or priced above the ceiling) toward `maxFallbackDepth` (default 2). A depth above the limit leaves the lot unsold.
- A paused lot keeps its old `endsAt` until it resumes; the deadline after a resume is the resume time plus the time left. Tick, bids and the hammer wait while paused (`closed` for a bid, `cannot_hammer` for the hammer). Extend adds time without using up a soft-close extension. Pause, resume and extend are refused `closed` when the lot is CLOSING or its deadline has passed, and `bad_command` for a repeated pause, a resume of a running lot and an extend of a paused lot.
- The reference reports the engine's `lot_not_open` as `closed`, as before.
- Seeded scenarios keep their base draws: the operator commands come from a second generator seeded from the seed and the scenario index, so seed 20261104 and the pinned scenario of D-0027 still give the same base scenarios.
- Parity fixtures for promote, revoke, abort and the closed-lot case are now `parity: true`; fixtures that use `complete` or ladders stay `parity: false`.

Alternatives:

- Leave the commands out of the reference: rejected, the fallback and clock rules would have no independent check.
- Stop counting skipped candidates in the depth: rejected, the engine counts them and R-ENG-057 bounds the whole walk.

Consequences:

- A divergence in these commands now fails the differential job with the scenario JSON.
- The reference has no settlement ops, so `complete`, `RecordSettlement` and the capture guard of promote (R8-E01) are still checked by fixtures only.

Evidence: reference/python/engine.py, reference/python/scenario_export.py, reference/python/test_scenario_export.py, packages/engine/test/golden-play.ts, packages/engine/fixtures/golden/pause-01-resume-shifts-deadline.json, R-ENG-044, R-ENG-054 to R-ENG-060, R-ENG-112, R-ENG-114, D-0025, D-0026.

## D-0031: Public export version 4 closes the round 12 privacy leaks

Date: 2026-11-05
Status: accepted
Owner: engine
Context: Review round 12 found four ways the version 3 public export still revealed private values. A private entry hash covers `prev`, the private hash of the entry before it, so the first unredacted entry after a redacted one committed to the redacted entry and its ceiling or sealed amount could be brute forced by hashing forward (R12-E01, issue #1550). Transcripts stayed on english lots although the spec shows them to auditors only (R12-E05, #1554). A proxy hammer kept `candidates[].priceCents`, and each runner-up price is the next lower secret maximum plus the increment (R12-E06, #1555). An `over_ceiling` rejection kept its amount and a `CANDIDATE_SKIPPED` kept its reason and price, both upper bounds on a ceiling (R12-E07, #1556).
Decision: The public export is version 4 (`PUBLIC_EXPORT_VERSION`, and `REPLAY_EXPORT_VERSION` in shared). From the first entry that loses a field to the end of the export, every entry carries `fullHash` null, or the keyed commitment when the auditor passes a `commitKey`; entries before it keep the private hash, which a viewer can recompute from public data anyway. Every `BID_RECORDED` and `BID_REJECTED` loses `audit.transcript` whatever the mode. A proxy `LOT_HAMMERED` keeps the winner's candidate price and drops `priceCents` from every later candidate (`candidates.priceCents` in `redacted`); a charged runner-up price is still published by `FALLBACK_PROMOTED`. A `BID_REJECTED` with reason `over_ceiling` loses `amountCents` and `amountRaw`; other rejections keep their amounts, since they only show a lower bound that an accepted bid would show too. `CANDIDATE_SKIPPED` keeps `lotId`, `bidderId` and `depth` and loses `reason` and `priceCents`. The private ledger, its hash vector and the golden fixtures do not change.
Alternatives:

- Null `fullHash` on every entry: rejected, it gives up a link that leaks nothing; the sticky rule is just as safe.
- Drop every rejected bid amount: rejected, only an over-ceiling rejection bounds a ceiling and the other amounts help a reader follow the room.
- Keep the version number: rejected, the same version would mean two different payload sets and `matchesLedger` on an old export would fail without saying why.

Consequences:

- Version 3 exports and replay bundles no longer verify (`bad_version`); rebuild them from the ledger.
- Without a commit key the public chain binds to the private ledger only up to the first redaction; the auditor re-derives the export from the ledger with `matchesLedger`, as before.
- A skipped candidate who was not revoked still tells a viewer that their ceiling did not cover their price at promotion time; hiding that would mean hiding who was promoted.

Evidence: packages/engine/src/ledger/public-export.ts, packages/engine/test/round12-privacy.test.ts, packages/engine/test/public-export.test.ts, packages/shared/src/replay-bundle.ts, SPEC-engine R-ENG-045, R-ENG-108, R-ENG-109, D-0020, D-0021.

## D-0032: Engine settlement, clock, scope and history fixes from review round 12

Date: 2026-11-05
Status: accepted
Owner: engine
Context: Review round 12 found that a captured lot sent to review could never be completed (R12-E02, issue #1551), that a promotion could leave a trailing bid above its bidder's ceiling so the next hammer threw forever (R12-E03, #1552), that a lot with no winner could record a whole capture history (R12-E04, #1553), that ExtendLot and ResumeLot could pass the hard close and decide trusted `extraMs` (R12-E08, #1557), that under holdScope lot the end of one hold revoked the bidder on every lot (R12-E09, #1558), that a promotion after a capture could end the lot unsold (R12-E10, #1559), that `closedAtSeq` named the ledger head (R12-E11, #1560), that a RecordSettlement ref starting with `promote:` was indexed as a promotion (R12-E12, #1561), and that `AUCTION_CREATED` stored a partial config filled from the current code defaults at replay (R12-E13, #1562).
Decision:

- Review resolution: RecordSettlement accepts FAILED_NEEDS_REVIEW to VOIDING and FAILED_NEEDS_REVIEW to SETTLED as operator steps with a non-empty ref. They are not added to `SETTLEMENT_EDGES`, which stays the saga graph. A lot that captured is then completed with CompleteLot and the auction can close.
- Promotion reserve: the headroom of a candidate is its available ceiling minus its best active bid on every OPEN or CLOSING lot in the same scope, leading or not. Every active bid then stays within its bidder's available ceiling, so the hammer's ceiling check stays an invariant and is not turned into a skip.
- A lot without a winner (unsold or aborted) never records a capture: a RecordSettlement step to CAPTURING or CAPTURED fails `state_continuity`, also after CloseAuction. The other saga steps stay allowed, because the saga passes BIDDING and WINNER_SELECTED before it releases the holds of a lot nobody won, and the settlement bridge replays that history.
- Hard close: a pause stops the clock, so the hard close moves by the paused time each LOT_RESUMED shows (`endsAtAfter - endsAtBefore`, kept on the lot as `pausedTotalMs`); soft close and ExtendLot are capped at that moved hard close, and an ExtendLot past it fails `bad_command`. decideExtendLot checks `extraMs` (safe integer 1..600000) itself. R-ENG-036 is amended to say so.
- Lot-scoped revocation: under holdScope lot a RevokeCeiling whose holdRef backs lot records revokes those records only, strikes bids on those lots only, and each CEILING_REVOKED carries an optional `lotId`. Such a record (`revokedLotOnly`) does not stop the bidder from registering for another lot. A revocation without a holdRef, or under holdScope event, is bidder-wide as before, whatever the reason; a caller that wants a declined card to cover every lot omits the holdRef.
- After a recorded capture a promotion that would end the lot unsold, including `fallbackPolicy: 'unsold'`, fails `state_continuity`.
- `LOT_HAMMERED.closedAtSeq` is the seq of the lot's own LOT_CLOSING; the lot keeps it as `closingSeq` only while it is CLOSING.
- `promote:` is a reserved ref prefix: RecordSettlement and parseCommand refuse it with `bad_command`.
- CreateAuction writes the whole validated config into AUCTION_CREATED, and the command body digest uses the same value. Replay fills an older partial config from `LEDGER_V1_AUCTION_DEFAULTS`, a frozen copy of today's defaults, never from `DEFAULT_AUCTION_CONFIG`; the entry body of an old entry is digested over that filled config, so a retry of the original command still dedupes.

Ledger compatibility: no new event type and no new command; the private ledger stays v1 and the hash vector is unchanged. The new payload fields (`CEILING_REVOKED.lotId`, a whole config in AUCTION_CREATED) are additive, and every older ledger replays to the same lots, winners, prices and settlements. The new state fields are optional and present only when they carry a value, so a state digest changes only where one applies. The demo gala fixture's pinned head hash changes because its AUCTION_CREATED now carries the whole config. The Python reference gains the `extraMs` range check; it has no hard close, holds or settlement, so the other rules are checked by engine tests.
Alternatives:

- A new ResolveReview command and event: rejected, two extra review edges on RecordSettlement say the same with no new event type.
- Allow only the void edges on a lot without a winner: rejected, the saga records HELD to BIDDING to WINNER_SELECTED to VOIDING for a lot nobody won, so the bridge could not record that release.
- Strike or skip an over-ceiling top bidder at the hammer: rejected, it hides the cause; the reserve keeps the invariant at the only place it can break.
- Cap a resumed deadline at the original hard close: rejected, a pause would eat the bidding time it was meant to protect.
- Keep bidder-wide revocation for a declined lot hold: rejected, the other lots are backed by their own holds; the caller can still revoke everywhere.
- Mark the promotion step with a payload flag instead of reserving the prefix: rejected, it changes the SETTLEMENT_STATE shape for every new entry.

Consequences:

- A runner-up with a trailing bid on the open lot is skipped when its ceiling cannot cover both.
- An operator console needs a RecordSettlement form for the two review steps; the payments saga is unchanged.
- An auctioneer extension near the hard close fails instead of passing it.

Evidence: packages/engine/src/decide/settlement.ts, packages/engine/src/decide/promote.ts, packages/engine/src/decide/revoke.ts, packages/engine/src/decide/pause.ts, packages/engine/src/decide/hammer.ts, packages/engine/src/decide/setup.ts, packages/engine/src/evolve.ts, packages/engine/src/config.ts, packages/engine/test/round12-engine.test.ts, reference/python/engine.py, SPEC-engine R-ENG-036, R-ENG-044, R-ENG-048, R-ENG-057, R-ENG-064, R-ENG-067, D-0025, D-0026.

## D-0033: Payments round 12: a paid sale is never ended by a slow release, a PENDING capture waits days, decision A sends no remainder void

Date: 2026-11-05
Status: accepted
Owner: payments
Context: Round 12 review findings R12-P01 to R12-P06 (issues #1563 to #1568). One ten-minute deadline (R-PAY-055) was applied to things that are not lost answers: a capture PayPal holds as PENDING, the voids and the remainder read after a confirmed capture, and the time the kill switch was engaged. A failed order read was taken as "captures not observable", which a captured hold turns into a review. The remainder check sent a void on every sale although G1 recorded decision A. The webhook verifier refused every transmission older than ten minutes although the 503 answers rely on PayPal's redeliveries.
Decision: Each deadline now matches what it waits for, and the recorded gate results are followed.

- A capture PayPal has reported PENDING (the capture answer or a truth read) is marked on the journal intent (`pendingSinceMs`) and waits under `pendingCaptureDeadlineMs`, default three days, instead of the ten-minute unknown deadline. It is adopted once COMPLETED and falls back once declined, as before (R11-O03). Reconcile treats a capture intent as in flight only while the journal is not terminal, so a capture completed after a review is reported as EXTRA_CAPTURE.
- A sale (winner set) never goes to FAILED_NEEDS_REVIEW because a void or the remainder read stays unconfirmed. Every run retries the pending voids before it judges their age. Past the deadline one `settlement_alert` audit entry and the `settlement_alerts_total` metric are raised (`void_unconfirmed:<bidderId>`, `remainder_unconfirmed`) and the saga keeps retrying until PayPal answers; the sale settles and is booked then. A no sale still goes to review after the retry (`void_unconfirmed`), and a void refused on a live hold still uses the resume budget (R-PAY-058).
- `PayPalGateway.getHoldTruth` with an order id throws an unknown-outcome `ORDER_UNREADABLE` error when the order answers 404, a body that does not parse, or a capture list it cannot read. `captures: null` now only means no order id was given.
- While the kill switch is engaged the unknown clock stands still: the run saves `unknownPausedAtMs` (the engage time, never before `unknownSince`), and the first run after the release adds the held time to `unknownSince`.
- The winner remainder follows the G1 decision (`remainderMode`, default A as in gates-result.json): A records `remainder_closed_by_paypal` and sends no void when the authorization reads CAPTURED with our final capture; B and `unknown` void explicitly as before; C records `remainder_unreleased` without a call.
- The webhook verifier refuses a transmission time more than ten minutes in the future or older than `maxRedeliveryAgeMs` (default seven days). An older time inside that horizon is a possible PayPal redelivery: it goes to PayPal's verify endpoint, within a quarter of the verify-call window (`maxRedeliveryCallsPerWindow`), and the event id is deduplicated as before.

Alternatives:

- A review to SETTLED or review to CAPTURED transition: rejected for now, the engine and the bridge treat FAILED_NEEDS_REVIEW as final (see R12-E02); keeping a paid sale out of review needs no new transition.
- Releasing the winner's hold when a pending capture is declined after its review: not done. Whether the authorization is open again after a decline is UNVERIFIED (A16), so the hold stays for the operator (`releaseReviewHolds`, voidAll), the safe side for the winner's funds.
- Widening the webhook age window without a separate call share: rejected, an old transmission time costs nothing to forge.

Consequences:

- A capture that stays PENDING keeps every candidate's hold for up to three days; the room shows the settlement pending meanwhile.
- A long PayPal outage after a capture leaves the lot SETTLING with an alert instead of a terminal review; it completes on its own when PayPal answers.
- A deployment that meets an open remainder (decision B or C, for example card buyers) must set `remainderMode`; the fake's `autoReleaseRemainder: false` is tested in mode B.
- UNVERIFIED: how long PayPal keeps a capture PENDING (A16), whether an automatic webhook retry keeps the original transmission id and time, and PayPal's retry horizon (W06, G4 recorded first deliveries only).

Evidence: docs/evidence/G1/G1-20261104T231047Z.jsonl and docs/evidence/G1/G1-20261105T123116Z.jsonl (G1.6, G1.7; release inferred, not read from a buyer balance), docs/GATES.md G4, packages/payments/src/fake/ASSUMPTIONS.md A01, A16, H14, W06, packages/payments/test/saga/r12.test.ts, R-PAY-055, R-PAY-058, R-PAY-059, R-PAY-063, issues #1563 to #1568.

## D-0034: Unused modules from the audit: wire what a requirement needs, delete what the service replaced

Date: 2026-11-06
Status: accepted
Owner: server
Context: Issues #1709, #1712, #1714 and #1716 found modules that only tests imported. Each was checked against the spec and against what the host already does.

Decision:

- `room/registry.ts` (RoomRegistry) and `room/recover-resume.ts` (startRecovery) are deleted with their tests. `AuctionService` already loads rooms lazily, enforces `MAX_ROOMS`, evicts finished rooms with no connections (least recently used first) and runs `resume()` at start-up and on its own timer, so R-RT-060 and R-RT-062 are met there. A second registry would hold a second copy of the room map.
- `log/context.ts`: the HTTP app now writes one request line per request through `withLogContext` with the request id the response carries (R-RT-133). `requestIdFrom` and `requestContext` stay for node handlers that do not go through `HttpApp`.
- `room/replay-feed.ts` (ReplayFeed) stays: R-RT-108 names it. The web replay screen drives its own playback from the export bundle, so the feed has no server caller; it is not exported from the package.
- Voice: `buildAudit` and the latency budget now run on every decision in the server voice bridge (R-VOX-071, R-VOX-101); the log line carries outcome and reason, never the transcript. Deepgram is selectable through `selectProvider` once a socket factory is given; the server passes the runtime WebSocket, so `VOICE_STT=deepgram` with `DEEPGRAM_API_KEY` runs it behind the cached fallback. `decide`, `rejectPrompt`, `budgetCheck` and `buildAudit` are exported from the package index.
- Not done here: the pipeline still composes score, merge, policy and validate inline instead of calling `decide()`; moving it is a larger change with its own risk to the recorded corpus. The browser modules (`MuteController`, `DropMonitor`, `CaptureController`, the capture worklet) and the redacting logger in `obs.ts` belong to the web host and stay for that work. The fake-payments provenance label and the per-hold release state (#1714) are web screens under `packages/web/src`, which this change does not touch.

Alternatives:

- Keep RoomRegistry and call it from the service: rejected, it duplicates eviction the service already has and tests.
- Delete `decide()` as superseded: rejected, R-VOX-071 describes that composition and the exported function is the reference the pipeline must keep matching.

Consequences:

- Eviction and recovery behavior is unchanged; the tests for them remain in the service suites.
- Every HTTP request now produces an info log line; it holds the method, path (no query) and status.

Evidence: git grep for each module name under packages/\*/src before this change.
