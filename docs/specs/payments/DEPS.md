# DEPS: payments

Key prefix PAY-. Waves: 1 start now, 2 needs wave 1 interfaces, 3 integration, 4 polish and submission.

## Unblocks

| Issue  | Title                                                                  | Wave | Depends on                                     | Unblocks                                                                               |
| ------ | ---------------------------------------------------------------------- | ---- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| PAY-01 | Payments package scaffold: tsconfig, vitest, exports, .env.example     | 1    | -                                              | PAY-66, PAY-73                                                                         |
| PAY-02 | Domain types, enums and error kinds                                    | 1    | -                                              | PAY-10, PAY-17, PAY-26, PAY-27, PAY-44, PAY-54                                         |
| PAY-03 | Port interfaces: PaymentsGateway, stores, AuditSink, Clock, KillSwitch | 1    | -                                              | PAY-16, PAY-17, PAY-25, PAY-26, PAY-38, PAY-53                                         |
| PAY-04 | Money conversion: centsToDecimal and decimalToCents                    | 1    | -                                              | PAY-07, PAY-14, PAY-15, PAY-17                                                         |
| PAY-05 | Config loader and redacted config dump                                 | 1    | -                                              | PAY-06, PAY-07                                                                         |
| PAY-06 | Sandbox-only guard                                                     | 2    | PAY-05                                         | PAY-13, PAY-16, PAY-57                                                                 |
| PAY-07 | Ceiling validator and demo cap                                         | 2    | PAY-04, PAY-05                                 | PAY-40                                                                                 |
| PAY-08 | Redaction and logPayment choke point                                   | 1    | -                                              | PAY-11, PAY-37, PAY-73                                                                 |
| PAY-09 | Deterministic PayPal-Request-Id builder                                | 1    | -                                              | PAY-11, PAY-29                                                                         |
| PAY-10 | Error classifier and mapping table                                     | 1    | PAY-02                                         | PAY-11                                                                                 |
| PAY-11 | HTTP transport: retry, backoff, jitter, Retry-After                    | 2    | PAY-10, PAY-09, PAY-08                         | PAY-12, PAY-13, PAY-46                                                                 |
| PAY-12 | Per-request timeout and outcome classification                         | 2    | PAY-11                                         | -                                                                                      |
| PAY-13 | OAuth token manager                                                    | 2    | PAY-11, PAY-06                                 | PAY-14, PAY-15, PAY-46                                                                 |
| PAY-14 | Orders v2 client                                                       | 2    | PAY-13, PAY-04                                 | PAY-16                                                                                 |
| PAY-15 | Payments v2 client: capture, void, reauthorize, get                    | 2    | PAY-13, PAY-04                                 | PAY-16, PAY-45                                                                         |
| PAY-16 | PayPalGateway facade and getHoldTruth                                  | 3    | PAY-14, PAY-15, PAY-21, PAY-06, PAY-03         | PAY-29, PAY-40, PAY-48, PAY-51, PAY-55                                                 |
| PAY-17 | Fake PayPal core: authorizations, orders, capture, void, reauthorize   | 2    | PAY-02, PAY-04, PAY-03                         | PAY-18, PAY-19, PAY-20, PAY-21, PAY-23, PAY-24, PAY-25, PAY-33                         |
| PAY-18 | Fake invariants and assertFakeInvariants helper                        | 2    | PAY-17                                         | PAY-29                                                                                 |
| PAY-19 | Fake idempotency semantics                                             | 2    | PAY-17                                         | -                                                                                      |
| PAY-20 | Fake fault injection engine                                            | 2    | PAY-17                                         | PAY-21, PAY-35                                                                         |
| PAY-21 | Fake PayPal HTTP server and routes                                     | 2    | PAY-17, PAY-20                                 | PAY-16, PAY-22, PAY-55, PAY-72                                                         |
| PAY-22 | Fake control API                                                       | 2    | PAY-21                                         | -                                                                                      |
| PAY-23 | Fake webhook emitter, signing and delivery modes                       | 2    | PAY-17                                         | PAY-46                                                                                 |
| PAY-24 | Fake assumptions register                                              | 2    | PAY-17                                         | -                                                                                      |
| PAY-25 | FakeGateway: in-process implementation of PaymentsGateway              | 2    | PAY-17, PAY-03                                 | PAY-29                                                                                 |
| PAY-26 | In-memory and JSON-file stores with shared contract tests              | 2    | PAY-03, PAY-02                                 | PAY-28, PAY-38, PAY-40, PAY-47, PAY-51                                                 |
| PAY-27 | Settlement state machine: pure step function                           | 2    | PAY-02                                         | PAY-28, PAY-29                                                                         |
| PAY-28 | Settlement creation, plan validation and lease                         | 3    | PAY-27, PAY-26                                 | PAY-29                                                                                 |
| PAY-29 | Capture phase: truth check, adopt, invariants, write-ahead intent      | 3    | PAY-27, PAY-28, PAY-16, PAY-25, PAY-09, PAY-18 | PAY-30, PAY-31, PAY-32, PAY-33, PAY-34, PAY-36, PAY-37, PAY-39, PAY-45, PAY-65, PAY-67 |
| PAY-30 | Runner-up fallback after definite capture failure                      | 3    | PAY-29                                         | PAY-34                                                                                 |
| PAY-31 | Unknown outcome handling and review deadline                           | 3    | PAY-29                                         | -                                                                                      |
| PAY-32 | Void phase with bounded concurrency and resume budget                  | 3    | PAY-29                                         | PAY-34, PAY-39                                                                         |
| PAY-33 | Winner remainder policy (G1 branches)                                  | 3    | PAY-29, PAY-17                                 | -                                                                                      |
| PAY-34 | Crash-point harness and single-crash equivalence tests                 | 3    | PAY-29, PAY-32, PAY-30                         | PAY-35, PAY-67, PAY-72                                                                 |
| PAY-35 | Double-crash chain and randomized fault property test                  | 3    | PAY-34, PAY-20                                 | -                                                                                      |
| PAY-36 | Determinism and invariant reporting in saga runs                       | 3    | PAY-29                                         | -                                                                                      |
| PAY-37 | Saga audit entries and settlement_update payloads                      | 3    | PAY-29, PAY-08                                 | PAY-72                                                                                 |
| PAY-38 | Kill switch implementation                                             | 2    | PAY-03, PAY-26                                 | PAY-39, PAY-40                                                                         |
| PAY-39 | Kill switch in the saga and voidAllLiveHolds                           | 3    | PAY-38, PAY-29, PAY-32                         | PAY-52                                                                                 |
| PAY-40 | HoldService: createHoldOrder and completeApproval                      | 3    | PAY-16, PAY-26, PAY-07, PAY-38                 | PAY-41                                                                                 |
| PAY-41 | Hold recovery sweep and stale flag                                     | 3    | PAY-40                                         | -                                                                                      |
| PAY-42 | Web contract: zod schemas, fixtures, SDK v6 contract note              | 1    | -                                              | PAY-43, PAY-60                                                                         |
| PAY-43 | Gate result flags and card-enable switch                               | 3    | PAY-42                                         | -                                                                                      |
| PAY-44 | ladderStep display mapping                                             | 2    | PAY-02                                         | -                                                                                      |
| PAY-45 | Reauthorize policy and call path (conditional on G3)                   | 4    | PAY-29, PAY-15                                 | -                                                                                      |
| PAY-46 | Webhook signature verifier and raw-body route contract                 | 3    | PAY-11, PAY-13, PAY-23                         | PAY-47, PAY-62                                                                         |
| PAY-47 | Webhook de-duplication                                                 | 3    | PAY-46, PAY-26                                 | PAY-48                                                                                 |
| PAY-48 | Webhook hints, observeHold and monotonic status merge                  | 3    | PAY-47, PAY-16                                 | PAY-49, PAY-50                                                                         |
| PAY-49 | Out-of-order and early events: orphans and sweep                       | 3    | PAY-48                                         | -                                                                                      |
| PAY-50 | Webhook handler responsiveness                                         | 3    | PAY-48                                         | -                                                                                      |
| PAY-51 | Reconciler: findings and report                                        | 3    | PAY-16, PAY-26                                 | PAY-52                                                                                 |
| PAY-52 | Reconciler repair option and timer                                     | 4    | PAY-51, PAY-39                                 | -                                                                                      |
| PAY-53 | Payments metrics                                                       | 2    | PAY-03                                         | -                                                                                      |
| PAY-54 | planFromOutcome: engine outcome to SettlementPlan                      | 3    | PAY-02                                         | -                                                                                      |
| PAY-55 | Gateway conformance suite (fake and sandbox)                           | 3    | PAY-16, PAY-21                                 | -                                                                                      |
| PAY-56 | Evidence format library: records, redaction, lint                      | 1    | -                                              | PAY-57, PAY-63                                                                         |
| PAY-57 | Gate runner base: recording HTTP, guard, --fake, --resume              | 2    | PAY-56, PAY-06                                 | PAY-59, PAY-60, PAY-61, PAY-62, PAY-64, PAY-66, PAY-67, PAY-68                         |
| PAY-58 | G0: create sandbox app and buyer accounts (wallet and card)            | 1    | -                                              | PAY-71                                                                                 |
| PAY-59 | G1 script: partial capture, remainder, explicit void                   | 2    | PAY-57                                         | PAY-70                                                                                 |
| PAY-60 | G2: SDK v6 AUTHORIZE page (wallet and guest card)                      | 2    | PAY-57, PAY-42                                 | -                                                                                      |
| PAY-61 | G3 script: reauthorize probe and timed day 3.5 / 4 / 5 checks          | 2    | PAY-57                                         | -                                                                                      |
| PAY-62 | G4: real webhook receiver, verification, simulator comparison          | 2    | PAY-57, PAY-46                                 | -                                                                                      |
| PAY-63 | gate:summarize and GATES.md template                                   | 2    | PAY-56                                         | -                                                                                      |
| PAY-64 | Rate-limit and latency measurement script                              | 2    | PAY-57                                         | PAY-65                                                                                 |
| PAY-65 | Compare measured latency with targets and set saga defaults            | 4    | PAY-64, PAY-29                                 | -                                                                                      |
| PAY-66 | Workflow: payments CI and manual gates dispatch                        | 2    | PAY-01, PAY-57                                 | -                                                                                      |
| PAY-67 | Sandbox crash-resume test: kill between capture and journal save       | 4    | PAY-29, PAY-57, PAY-34                         | -                                                                                      |
| PAY-68 | Sandbox idempotency probe                                              | 4    | PAY-57                                         | -                                                                                      |
| PAY-69 | Refund and dispute boundary note                                       | 4    | -                                              | -                                                                                      |
| PAY-70 | Flip UNVERIFIED tags after each gate                                   | 3    | PAY-59                                         | -                                                                                      |
| PAY-71 | Gate failure escalation runbook                                        | 2    | PAY-58                                         | -                                                                                      |
| PAY-72 | Demo script: settlement with crash and resume                          | 4    | PAY-34, PAY-37, PAY-21                         | -                                                                                      |
| PAY-73 | Security checks: secret scan test, dependency policy                   | 3    | PAY-08, PAY-01                                 | -                                                                                      |

## Critical path

scaffold + types + ports (wave 1) -> fake core + fault engine + HTTP server -> gateway -> capture phase -> fallback / unknown / void -> crash harness -> demo script. Gates G1-G4 run in parallel on the gate base once the sandbox app exists (G0).

## Cross-area dependencies

- engine: Outcome shape used by the plan mapper (see plan_map issue).
- realtime: routes for /api/holds, raw-body webhook route, SQL adapters from the store contract suite, settlement_update and audit_event envelopes.
- web: consumes the contract fixtures and ladderStep.
- quality/infra: workflows for payments CI and the manual gates dispatch.

## Coverage: requirement -> issue

| Requirement | Issues                         |
| ----------- | ------------------------------ |
| R-PAY-001   | PAY-05                         |
| R-PAY-002   | PAY-06                         |
| R-PAY-003   | PAY-06, PAY-14                 |
| R-PAY-004   | PAY-06                         |
| R-PAY-005   | PAY-07                         |
| R-PAY-006   | PAY-38                         |
| R-PAY-007   | PAY-08, PAY-56, PAY-73         |
| R-PAY-010   | PAY-13                         |
| R-PAY-011   | PAY-14                         |
| R-PAY-012   | PAY-15                         |
| R-PAY-013   | PAY-09, PAY-68                 |
| R-PAY-014   | PAY-09, PAY-11                 |
| R-PAY-015   | PAY-11                         |
| R-PAY-016   | PAY-12                         |
| R-PAY-017   | PAY-10                         |
| R-PAY-018   | PAY-10                         |
| R-PAY-019   | PAY-16                         |
| R-PAY-020   | PAY-04                         |
| R-PAY-021   | PAY-03, PAY-16, PAY-25         |
| R-PAY-030   | PAY-40                         |
| R-PAY-031   | PAY-07                         |
| R-PAY-032   | PAY-40                         |
| R-PAY-033   | PAY-40                         |
| R-PAY-034   | PAY-41                         |
| R-PAY-035   | PAY-42                         |
| R-PAY-036   | PAY-42                         |
| R-PAY-037   | PAY-43                         |
| R-PAY-038   | PAY-02, PAY-44                 |
| R-PAY-040   | PAY-02, PAY-27                 |
| R-PAY-041   | PAY-27                         |
| R-PAY-042   | PAY-26, PAY-34                 |
| R-PAY-043   | PAY-27                         |
| R-PAY-044   | PAY-28, PAY-54                 |
| R-PAY-045   | PAY-26, PAY-28                 |
| R-PAY-050   | PAY-29                         |
| R-PAY-051   | PAY-15, PAY-29                 |
| R-PAY-052   | PAY-29                         |
| R-PAY-053   | PAY-30                         |
| R-PAY-054   | PAY-31                         |
| R-PAY-055   | PAY-31                         |
| R-PAY-056   | PAY-29                         |
| R-PAY-057   | PAY-32                         |
| R-PAY-058   | PAY-32                         |
| R-PAY-059   | PAY-33                         |
| R-PAY-060   | PAY-34, PAY-35, PAY-67, PAY-72 |
| R-PAY-061   | PAY-18, PAY-35, PAY-36, PAY-72 |
| R-PAY-062   | PAY-32                         |
| R-PAY-063   | PAY-39                         |
| R-PAY-064   | PAY-37                         |
| R-PAY-065   | PAY-30                         |
| R-PAY-070   | PAY-45                         |
| R-PAY-071   | PAY-45                         |
| R-PAY-072   | PAY-45                         |
| R-PAY-090   | PAY-46                         |
| R-PAY-091   | PAY-46                         |
| R-PAY-092   | PAY-46                         |
| R-PAY-093   | PAY-46                         |
| R-PAY-094   | PAY-47                         |
| R-PAY-095   | PAY-48                         |
| R-PAY-096   | PAY-49                         |
| R-PAY-097   | PAY-48                         |
| R-PAY-098   | PAY-48                         |
| R-PAY-099   | PAY-50                         |
| R-PAY-100   | PAY-51                         |
| R-PAY-101   | PAY-52                         |
| R-PAY-102   | PAY-52                         |
| R-PAY-103   | PAY-51                         |
| R-PAY-110   | PAY-03, PAY-38                 |
| R-PAY-111   | PAY-38                         |
| R-PAY-112   | PAY-39                         |
| R-PAY-113   | PAY-38                         |
| R-PAY-120   | PAY-17, PAY-21                 |
| R-PAY-121   | PAY-22                         |
| R-PAY-122   | PAY-20                         |
| R-PAY-123   | PAY-19                         |
| R-PAY-124   | PAY-17, PAY-24                 |
| R-PAY-125   | PAY-17                         |
| R-PAY-126   | PAY-23, PAY-49                 |
| R-PAY-127   | PAY-18                         |
| R-PAY-128   | PAY-55                         |
| R-PAY-130   | PAY-08                         |
| R-PAY-131   | PAY-53                         |
| R-PAY-132   | PAY-37                         |
| R-PAY-140   | PAY-57                         |
| R-PAY-141   | PAY-56, PAY-63                 |
| R-PAY-142   | PAY-57                         |
| R-PAY-143   | PAY-59                         |
| R-PAY-144   | PAY-60                         |
| R-PAY-145   | PAY-61                         |
| R-PAY-146   | PAY-62                         |
| R-PAY-147   | PAY-64                         |
| R-PAY-148   | PAY-58, PAY-70, PAY-71         |
| R-PAY-150   | PAY-36                         |
| R-PAY-151   | PAY-01, PAY-66                 |
| R-PAY-152   | PAY-65                         |
| R-PAY-153   | PAY-01, PAY-73                 |

## Coverage: test -> issue

| Test      | Issues |
| --------- | ------ |
| T-PAY-001 | PAY-04 |
| T-PAY-002 | PAY-04 |
| T-PAY-003 | PAY-06 |
| T-PAY-004 | PAY-06 |
| T-PAY-005 | PAY-06 |
| T-PAY-006 | PAY-07 |
| T-PAY-007 | PAY-08 |
| T-PAY-008 | PAY-09 |
| T-PAY-009 | PAY-10 |
| T-PAY-010 | PAY-11 |
| T-PAY-011 | PAY-11 |
| T-PAY-012 | PAY-12 |
| T-PAY-013 | PAY-13 |
| T-PAY-014 | PAY-13 |
| T-PAY-015 | PAY-14 |
| T-PAY-016 | PAY-14 |
| T-PAY-017 | PAY-15 |
| T-PAY-018 | PAY-10 |
| T-PAY-019 | PAY-16 |
| T-PAY-020 | PAY-40 |
| T-PAY-021 | PAY-40 |
| T-PAY-022 | PAY-40 |
| T-PAY-023 | PAY-41 |
| T-PAY-024 | PAY-42 |
| T-PAY-025 | PAY-43 |
| T-PAY-026 | PAY-41 |
| T-PAY-027 | PAY-38 |
| T-PAY-030 | PAY-27 |
| T-PAY-031 | PAY-27 |
| T-PAY-032 | PAY-28 |
| T-PAY-033 | PAY-29 |
| T-PAY-034 | PAY-29 |
| T-PAY-035 | PAY-32 |
| T-PAY-036 | PAY-30 |
| T-PAY-037 | PAY-30 |
| T-PAY-038 | PAY-30 |
| T-PAY-039 | PAY-31 |
| T-PAY-040 | PAY-31 |
| T-PAY-041 | PAY-31 |
| T-PAY-042 | PAY-32 |
| T-PAY-043 | PAY-33 |
| T-PAY-044 | PAY-34 |
| T-PAY-045 | PAY-34 |
| T-PAY-046 | PAY-34 |
| T-PAY-047 | PAY-35 |
| T-PAY-048 | PAY-39 |
| T-PAY-049 | PAY-37 |
| T-PAY-050 | PAY-36 |
| T-PAY-051 | PAY-45 |
| T-PAY-052 | PAY-35 |
| T-PAY-053 | PAY-28 |
| T-PAY-060 | PAY-46 |
| T-PAY-061 | PAY-46 |
| T-PAY-062 | PAY-47 |
| T-PAY-063 | PAY-48 |
| T-PAY-064 | PAY-49 |
| T-PAY-065 | PAY-49 |
| T-PAY-066 | PAY-48 |
| T-PAY-067 | PAY-48 |
| T-PAY-068 | PAY-50 |
| T-PAY-069 | PAY-23 |
| T-PAY-070 | PAY-56 |
| T-PAY-071 | PAY-51 |
| T-PAY-072 | PAY-52 |
| T-PAY-073 | PAY-39 |
| T-PAY-074 | PAY-21 |
| T-PAY-075 | PAY-20 |
| T-PAY-076 | PAY-19 |
| T-PAY-077 | PAY-17 |
| T-PAY-078 | PAY-18 |
| T-PAY-079 | PAY-59 |
| T-PAY-080 | PAY-64 |
| T-PAY-081 | PAY-55 |
| T-PAY-090 | PAY-59 |
| T-PAY-091 | PAY-60 |
| T-PAY-092 | PAY-61 |
| T-PAY-093 | PAY-62 |
| T-PAY-094 | PAY-67 |
| T-PAY-095 | PAY-68 |
