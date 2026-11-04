# DEPS: engine area

## Waves

- Wave 1: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, ENG-08, ENG-09, ENG-10
- Wave 2: ENG-11, ENG-12, ENG-13, ENG-14, ENG-15, ENG-16, ENG-17, ENG-18, ENG-19, ENG-20, ENG-21, ENG-22, ENG-23, ENG-24, ENG-25, ENG-26, ENG-27, ENG-28, ENG-29, ENG-30, ENG-31, ENG-32, ENG-33, ENG-34
- Wave 3: ENG-35, ENG-36, ENG-37, ENG-38, ENG-39, ENG-40, ENG-41, ENG-42, ENG-43, ENG-44, ENG-45, ENG-46, ENG-47, ENG-48, ENG-49, ENG-50, ENG-51, ENG-52, ENG-53, ENG-54, ENG-55, ENG-56, ENG-57, ENG-58, ENG-59, ENG-60, ENG-61, ENG-62
- Wave 4: ENG-63, ENG-64, ENG-65, ENG-66

## Critical path
ENG-02/03 -> ENG-11 -> ENG-26 -> ENG-32/34 -> ENG-33 -> ENG-40 -> ENG-42 -> ENG-43/55; fixtures ENG-07 -> ENG-19..23 -> ENG-47; Python side ENG-07 -> ENG-24 -> ENG-25 -> ENG-54.

## Unblocks (issue -> issues that depend on it)

- ENG-01 (Land the TypeScript engine branch on main in the monorepo layout): leaf
- ENG-02 (Core domain types: branded Cents, EpochMs, ULID ids, Mode, config shapes): ENG-11, ENG-12, ENG-13, ENG-27, ENG-28
- ENG-03 (Reject reasons registry and EngineError/InvariantError classes): ENG-11, ENG-12, ENG-29
- ENG-04 (Canonical JSON encoder): ENG-16
- ENG-05 (Pure TypeScript SHA-256 behind a Hasher interface): ENG-16, ENG-62
- ENG-06 (Clock abstraction: Clock, SystemClock, ManualClock, monotonicAt): leaf
- ENG-07 (Golden fixture schema, loader and README): ENG-19, ENG-20, ENG-21, ENG-22, ENG-23, ENG-24, ENG-25
- ENG-08 (Ceiling policy constants and registration bounds): ENG-30
- ENG-09 (Determinism lint rule and import boundary check): leaf
- ENG-10 (Coverage thresholds and traceability script): ENG-66
- ENG-11 (Command and ledger event unions): ENG-16, ENG-17, ENG-26, ENG-27, ENG-33, ENG-56
- ENG-12 (Config validators with defaults): ENG-28, ENG-30, ENG-58
- ENG-13 (Ranking and tie-break module): ENG-14, ENG-15, ENG-26
- ENG-14 (Pricing rules for english and second_price): ENG-29, ENG-34
- ENG-15 (Pricing rules for proxy mode and increment ladders): ENG-29, ENG-34
- ENG-16 (Ledger sealing and chain verification): ENG-40, ENG-61, ENG-62
- ENG-17 (LedgerStore interface and InMemoryLedgerStore): ENG-18, ENG-42
- ENG-18 (Store contract-test kit): leaf
- ENG-19 (Golden fixtures: english mode (14 fixtures)): ENG-47
- ENG-20 (Golden fixtures: proxy mode (12 fixtures)): ENG-47
- ENG-21 (Golden fixtures: second_price mode (10 fixtures)): ENG-47
- ENG-22 (Golden fixtures: soft close and boundary times (10 fixtures)): ENG-47
- ENG-23 (Golden fixtures: reject ordering and ceilings (8 fixtures)): ENG-47
- ENG-24 (Python golden runner for the reference engine): ENG-25
- ENG-25 (Python seeded scenario exporter for differential testing): ENG-54
- ENG-26 (State model and evolve reducer): ENG-30, ENG-31, ENG-32, ENG-33, ENG-34, ENG-40, ENG-41
- ENG-27 (Exposure and available-ceiling accounting): ENG-29, ENG-36, ENG-37, ENG-38, ENG-39
- ENG-28 (Soft close rules module): ENG-32
- ENG-29 (Bid validation pipeline): ENG-32, ENG-58
- ENG-30 (Decide: auction creation, lots, bidder registration and ceiling raise): ENG-31
- ENG-31 (Decide: OpenLot and lot sequencing): ENG-39
- ENG-32 (Decide: PlaceBid, audit record, soft close event, implicit close): ENG-37, ENG-42, ENG-46, ENG-47, ENG-48, ENG-51
- ENG-33 (Command idempotency, conflict detection and purity wrapper): ENG-42, ENG-56
- ENG-34 (Decide: Tick, early hammer and LOT_HAMMERED outcome): ENG-35, ENG-38, ENG-42, ENG-46, ENG-47, ENG-48, ENG-50
- ENG-35 (Candidates list and recompute-without-disqualified): ENG-36
- ENG-36 (Decide: PromoteRunnerUp and fallback policy): ENG-49
- ENG-37 (Decide: RevokeCeiling with bid striking): leaf
- ENG-38 (Decide: CompleteLot and RecordSettlement ledger entries): ENG-39, ENG-65
- ENG-39 (Multi-lot exposure rules and CloseAuction): ENG-49
- ENG-40 (Replay, stateDigest and verified hydrate): ENG-42, ENG-52
- ENG-41 (Projections: public, bidder, auditor, alias hook): ENG-63, ENG-65
- ENG-42 (AuctionRuntime: serial dispatch, hydrate, durable append): ENG-43, ENG-44, ENG-45, ENG-52, ENG-53, ENG-57, ENG-60, ENG-63, ENG-65
- ENG-43 (Runtime conflict retry and torn-write recovery): ENG-55
- ENG-44 (Runtime subscribe stream): leaf
- ENG-45 (Runtime metrics hook): leaf
- ENG-46 (Legacy Auction adapter on the new core): leaf
- ENG-47 (TypeScript golden runner over all fixtures): ENG-54, ENG-59
- ENG-48 (Property tests: pricing, ranking and ceilings (fast-check)): leaf
- ENG-49 (Property tests: ceilings, exposure and multi-lot): leaf
- ENG-50 (Property tests: second-price truthfulness and mechanism checks (port)): leaf
- ENG-51 (Property tests: soft close): leaf
- ENG-52 (Property tests: ledger, mutation detection and replay equality): leaf
- ENG-53 (Property tests: idempotency, time shift and arrival-order invariance): leaf
- ENG-54 (Differential CI job: TypeScript vs Python on 2000 seeded scenarios): leaf
- ENG-55 (Fault-injection suite for runtime and store): leaf
- ENG-56 (Fuzz and security tests for command parsing): leaf
- ENG-57 (Performance benchmark and budget tests): ENG-66
- ENG-58 (Contract tests with shared: reject codes and config schemas): leaf
- ENG-59 (Demo fixture: charity gala replay): ENG-60, ENG-65
- ENG-60 (Scripted replay driver with virtual clock): leaf
- ENG-61 (Ledger export, verify CLI and tamper demo helpers): leaf
- ENG-62 (Browser and edge bundle check): leaf
- ENG-63 (Public API surface and snapshot test): ENG-64
- ENG-64 (Package README: commands, ledger format, hash vector, fixtures): ENG-66
- ENG-65 (End-to-end engine scenario through runtime and settlement entries): leaf
- ENG-66 (Release readiness: coverage run, trace check and API review): leaf

## Cross-area needs
- shared (realtime): ids, money type, error-code list. Engine ships local types and ENG-58 fails when codes drift.
- realtime: implements `LedgerStore` adapters using ENG-18 contract kit; hosts `AuctionRuntime` (ENG-42); uses `projectPublic` for every broadcast.
- payments: consumes `candidates` from LOT_HAMMERED; sends `CompleteLot`, `RecordSettlement`, `PromoteRunnerUp`, `RevokeCeiling`; owns the settlement transition graph.
- web: imports `CEILING_PRESETS_CENTS` (ENG-08), `verifyJsonl` (ENG-61), replay driver (ENG-60), demo fixture (ENG-59).
- quality/infra: workflow steps for typecheck, lint, coverage, Python golden runner, differential job (ENG-10, ENG-24, ENG-54); request only, engine does not edit `.github/`.

## Coverage table: requirement -> issue
| Requirement | Issue |
|---|---|
| R-ENG-001 (money-int) | ENG-29 |
| R-ENG-002 (money-usd) | ENG-02 |
| R-ENG-003 (time-ms) | ENG-02 |
| R-ENG-004 (time-mono) | ENG-06 |
| R-ENG-005 (ids-ulid) | ENG-29 |
| R-ENG-006 (ids-proto) | ENG-04 |
| R-ENG-007 (size-limits) | ENG-02 |
| R-ENG-008 (cfg-validate) | ENG-12 |
| R-ENG-009 (cfg-defaults) | ENG-12 |
| R-ENG-010 (cfg-reserve-inc) | ENG-12 |
| R-ENG-011 (cfg-sealed-soft) | ENG-12 |
| R-ENG-012 (cfg-soft-bounds) | ENG-12 |
| R-ENG-013 (cfg-hold-scope) | ENG-12 |
| R-ENG-014 (cfg-policy) | ENG-08 |
| R-ENG-015 (cfg-frozen) | ENG-30 |
| R-ENG-016 (english-first) | ENG-14 |
| R-ENG-017 (english-price) | ENG-14 |
| R-ENG-018 (english-leading) | ENG-14 |
| R-ENG-019 (proxy-price) | ENG-15 |
| R-ENG-020 (proxy-own) | ENG-15 |
| R-ENG-021 (proxy-tie) | ENG-15 |
| R-ENG-022 (sealed-one) | ENG-14 |
| R-ENG-023 (sealed-price) | ENG-14 |
| R-ENG-024 (rank-order) | ENG-13 |
| R-ENG-025 (ladder) | ENG-15 |
| R-ENG-026 (price-le-ceiling) | ENG-14 |
| R-ENG-027 (val-order) | ENG-29 |
| R-ENG-028 (val-codes) | ENG-03 |
| R-ENG-029 (val-unreg) | ENG-29 |
| R-ENG-030 (val-confirm) | ENG-29 |
| R-ENG-031 (val-atomic) | ENG-32 |
| R-ENG-032 (val-binding) | ENG-32 |
| R-ENG-033 (val-implicit-close) | ENG-32 |
| R-ENG-034 (sc-trigger) | ENG-28 |
| R-ENG-035 (sc-boundary) | ENG-28 |
| R-ENG-036 (sc-cap) | ENG-28 |
| R-ENG-037 (sc-sealed) | ENG-28 |
| R-ENG-038 (sc-event) | ENG-32 |
| R-ENG-039 (sc-no-reject-extend) | ENG-28 |
| R-ENG-040 (ceil-reg) | ENG-08 |
| R-ENG-041 (ceil-raise) | ENG-30 |
| R-ENG-042 (ceil-over) | ENG-27 |
| R-ENG-043 (ceil-cumulative) | ENG-27 |
| R-ENG-044 (ceil-revoke) | ENG-37 |
| R-ENG-045 (ceil-private) | ENG-41 |
| R-ENG-046 (ceil-holdref) | ENG-27 |
| R-ENG-047 (ham-state) | ENG-34 |
| R-ENG-048 (ham-outcome) | ENG-34 |
| R-ENG-049 (ham-nobids) | ENG-34 |
| R-ENG-050 (ham-price) | ENG-34 |
| R-ENG-051 (ham-candidates) | ENG-35 |
| R-ENG-052 (ham-early) | ENG-34 |
| R-ENG-053 (ham-deadline) | ENG-34 |
| R-ENG-054 (fb-promote) | ENG-36 |
| R-ENG-055 (fb-price) | ENG-35 |
| R-ENG-056 (fb-skip) | ENG-36 |
| R-ENG-057 (fb-depth) | ENG-36 |
| R-ENG-058 (fb-commit) | ENG-36 |
| R-ENG-059 (fb-audit) | ENG-36 |
| R-ENG-060 (fb-policy) | ENG-36 |
| R-ENG-061 (ml-seq) | ENG-31 |
| R-ENG-062 (ml-order) | ENG-30 |
| R-ENG-063 (ml-expose) | ENG-39 |
| R-ENG-064 (ml-close) | ENG-39 |
| R-ENG-065 (ml-isolation) | ENG-31 |
| R-ENG-066 (set-complete) | ENG-38 |
| R-ENG-067 (set-state) | ENG-38 |
| R-ENG-068 (set-final) | ENG-34 |
| R-ENG-069 (set-invariant) | ENG-38 |
| R-ENG-070 (led-entry) | ENG-11 |
| R-ENG-071 (led-canon) | ENG-04 |
| R-ENG-072 (led-hash) | ENG-16 |
| R-ENG-073 (led-seq) | ENG-16 |
| R-ENG-074 (led-verify) | ENG-16 |
| R-ENG-075 (led-anchor) | ENG-16 |
| R-ENG-076 (led-batch) | ENG-17 |
| R-ENG-077 (led-immut) | ENG-16 |
| R-ENG-078 (led-export) | ENG-61 |
| R-ENG-079 (led-sha) | ENG-05 |
| R-ENG-080 (led-version) | ENG-16 |
| R-ENG-081 (aud-fields) | ENG-32 |
| R-ENG-082 (aud-raw) | ENG-32 |
| R-ENG-083 (aud-voice) | ENG-32 |
| R-ENG-084 (aud-source) | ENG-11 |
| R-ENG-085 (aud-client-ts) | ENG-32 |
| R-ENG-086 (aud-hidden) | ENG-32 |
| R-ENG-087 (cmd-idem) | ENG-33 |
| R-ENG-088 (cmd-conflict) | ENG-33 |
| R-ENG-089 (cmd-unknown) | ENG-11 |
| R-ENG-090 (cmd-pure) | ENG-33 |
| R-ENG-091 (cmd-result) | ENG-03 |
| R-ENG-092 (rep-fold) | ENG-26 |
| R-ENG-093 (rep-digest) | ENG-40 |
| R-ENG-094 (rep-verify) | ENG-40 |
| R-ENG-095 (rep-total) | ENG-26 |
| R-ENG-096 (rep-time-shift) | ENG-53 |
| R-ENG-097 (rep-order) | ENG-50 |
| R-ENG-098 (rt-serial) | ENG-42 |
| R-ENG-099 (rt-hydrate) | ENG-42 |
| R-ENG-100 (rt-durable) | ENG-42 |
| R-ENG-101 (rt-conflict) | ENG-43 |
| R-ENG-102 (rt-torn) | ENG-43 |
| R-ENG-103 (rt-subscribe) | ENG-44 |
| R-ENG-104 (rt-store) | ENG-17 |
| R-ENG-105 (rt-metrics) | ENG-45 |
| R-ENG-106 (prj-public) | ENG-41 |
| R-ENG-107 (prj-bidder) | ENG-41 |
| R-ENG-108 (prj-auditor) | ENG-41 |
| R-ENG-109 (prj-sealed) | ENG-41 |
| R-ENG-110 (prj-alias) | ENG-41 |
| R-ENG-111 (gold-schema) | ENG-07 |
| R-ENG-112 (gold-parity) | ENG-19 |
| R-ENG-113 (gold-pyrunner) | ENG-24 |
| R-ENG-114 (gold-diff) | ENG-54 |
| R-ENG-115 (gold-demo) | ENG-59 |
| R-ENG-116 (compat-legacy) | ENG-46 |
| R-ENG-117 (nfr-latency) | ENG-57 |
| R-ENG-118 (nfr-replay-perf) | ENG-57 |
| R-ENG-119 (nfr-deps) | ENG-09 |
| R-ENG-120 (nfr-edge) | ENG-62 |
| R-ENG-121 (nfr-determinism) | ENG-09 |
| R-ENG-122 (nfr-coverage) | ENG-10 |
| R-ENG-123 (nfr-ci) | ENG-01 |
| R-ENG-124 (nfr-trace) | ENG-10 |
| R-ENG-125 (nfr-api) | ENG-63 |
| R-ENG-126 (nfr-docs) | ENG-64 |

## Coverage table: test -> issue
| Test | Issue |
|---|---|
| T-ENG-001 (money-bad) | ENG-29 |
| T-ENG-002 (money-currency) | ENG-02 |
| T-ENG-003 (time-no-clock) | ENG-02 |
| T-ENG-004 (time-regress) | ENG-06 |
| T-ENG-005 (ids-bad) | ENG-29 |
| T-ENG-006 (ids-proto) | ENG-04 |
| T-ENG-007 (size-limits) | ENG-02 |
| T-ENG-008 (cfg-errors) | ENG-12 |
| T-ENG-009 (cfg-defaults) | ENG-12 |
| T-ENG-010 (cfg-sealed-soft) | ENG-12 |
| T-ENG-011 (cfg-bounds) | ENG-12 |
| T-ENG-012 (cfg-scope) | ENG-12 |
| T-ENG-013 (cfg-presets) | ENG-08 |
| T-ENG-014 (en-basic) | ENG-14 |
| T-ENG-015 (en-ladder) | ENG-15 |
| T-ENG-016 (px-basic) | ENG-15 |
| T-ENG-017 (px-tie) | ENG-15 |
| T-ENG-018 (px-top-cap) | ENG-15 |
| T-ENG-019 (sp-basic) | ENG-14 |
| T-ENG-020 (sp-below-second) | ENG-14 |
| T-ENG-021 (rank-total) | ENG-13 |
| T-ENG-022 (val-order) | ENG-29 |
| T-ENG-023 (val-unconfirmed) | ENG-29 |
| T-ENG-024 (val-atomic) | ENG-32 |
| T-ENG-025 (val-binding) | ENG-32 |
| T-ENG-026 (val-implicit-close) | ENG-32 |
| T-ENG-027 (sc-boundaries) | ENG-28 |
| T-ENG-028 (sc-cap) | ENG-28 |
| T-ENG-029 (aud-fields) | ENG-32 |
| T-ENG-030 (aud-client-ts) | ENG-32 |
| T-ENG-031 (ceil-over) | ENG-27 |
| T-ENG-032 (ceil-raise) | ENG-30 |
| T-ENG-033 (ceil-holdref) | ENG-27 |
| T-ENG-034 (ceil-revoke-open) | ENG-37 |
| T-ENG-035 (ceil-revoke-after) | ENG-37 |
| T-ENG-036 (ham-states) | ENG-34 |
| T-ENG-037 (ham-outcome) | ENG-34 |
| T-ENG-038 (ham-nobids) | ENG-34 |
| T-ENG-039 (ham-deadline) | ENG-34 |
| T-ENG-040 (fb-english) | ENG-36 |
| T-ENG-041 (fb-proxy) | ENG-35 |
| T-ENG-042 (fb-sealed) | ENG-35 |
| T-ENG-043 (fb-skip) | ENG-36 |
| T-ENG-044 (fb-depth) | ENG-36 |
| T-ENG-045 (fb-wrong-winner) | ENG-36 |
| T-ENG-046 (ml-seq) | ENG-31 |
| T-ENG-047 (ml-expose) | ENG-39 |
| T-ENG-048 (ml-close) | ENG-39 |
| T-ENG-049 (set-complete) | ENG-38 |
| T-ENG-050 (set-state) | ENG-38 |
| T-ENG-051 (set-invariant) | ENG-38 |
| T-ENG-052 (led-vector) | ENG-16 |
| T-ENG-053 (led-canon) | ENG-04 |
| T-ENG-054 (led-sha) | ENG-05 |
| T-ENG-055 (led-seq) | ENG-16 |
| T-ENG-056 (led-mutate) | ENG-16 |
| T-ENG-057 (led-structure) | ENG-16 |
| T-ENG-058 (led-anchor) | ENG-16 |
| T-ENG-059 (led-batch) | ENG-17 |
| T-ENG-060 (led-immut) | ENG-16 |
| T-ENG-061 (cmd-idem) | ENG-33 |
| T-ENG-062 (cmd-conflict) | ENG-33 |
| T-ENG-063 (cmd-unknown) | ENG-11 |
| T-ENG-064 (cmd-pure) | ENG-33 |
| T-ENG-065 (rep-prefix) | ENG-26 |
| T-ENG-066 (rep-failclosed) | ENG-40 |
| T-ENG-067 (rep-unknown) | ENG-26 |
| T-ENG-068 (rep-shift) | ENG-53 |
| T-ENG-069 (rep-perm) | ENG-50 |
| T-ENG-070 (rt-serial) | ENG-42 |
| T-ENG-071 (rt-durable) | ENG-42 |
| T-ENG-072 (rt-conflict) | ENG-43 |
| T-ENG-073 (rt-torn) | ENG-43 |
| T-ENG-074 (rt-subscribe) | ENG-44 |
| T-ENG-075 (rt-store-kit) | ENG-18 |
| T-ENG-076 (rt-metrics) | ENG-45 |
| T-ENG-077 (prj-public) | ENG-41 |
| T-ENG-078 (prj-bidder) | ENG-41 |
| T-ENG-079 (prj-sealed) | ENG-41 |
| T-ENG-080 (gold-schema) | ENG-07 |
| T-ENG-081 (gold-parity) | ENG-47 |
| T-ENG-082 (gold-diff) | ENG-54 |
| T-ENG-083 (gold-demo) | ENG-65 |
| T-ENG-084 (nfr-latency) | ENG-57 |
| T-ENG-085 (nfr-deps) | ENG-09 |
| T-ENG-086 (nfr-trace) | ENG-66 |

## Coverage table: issue -> requirement and test ids
| Issue | Requirements | Tests |
|---|---|---|
| ENG-01 | R-ENG-123 | - |
| ENG-02 | R-ENG-002, R-ENG-003, R-ENG-007 | T-ENG-002, T-ENG-003, T-ENG-007 |
| ENG-03 | R-ENG-028, R-ENG-091 | - |
| ENG-04 | R-ENG-006, R-ENG-071 | T-ENG-006, T-ENG-053 |
| ENG-05 | R-ENG-079 | T-ENG-054 |
| ENG-06 | R-ENG-004 | T-ENG-004 |
| ENG-07 | R-ENG-111 | T-ENG-080 |
| ENG-08 | R-ENG-014, R-ENG-040 | T-ENG-013 |
| ENG-09 | R-ENG-119, R-ENG-121 | T-ENG-085 |
| ENG-10 | R-ENG-122, R-ENG-124 | - |
| ENG-11 | R-ENG-070, R-ENG-084, R-ENG-089 | T-ENG-063 |
| ENG-12 | R-ENG-008, R-ENG-009, R-ENG-010, R-ENG-011, R-ENG-012, R-ENG-013 | T-ENG-008, T-ENG-009, T-ENG-010, T-ENG-011, T-ENG-012 |
| ENG-13 | R-ENG-024 | T-ENG-021 |
| ENG-14 | R-ENG-016, R-ENG-017, R-ENG-018, R-ENG-022, R-ENG-023, R-ENG-026 | T-ENG-014, T-ENG-019, T-ENG-020 |
| ENG-15 | R-ENG-019, R-ENG-020, R-ENG-021, R-ENG-025 | T-ENG-015, T-ENG-016, T-ENG-017, T-ENG-018 |
| ENG-16 | R-ENG-072, R-ENG-073, R-ENG-074, R-ENG-075, R-ENG-077, R-ENG-080 | T-ENG-052, T-ENG-055, T-ENG-056, T-ENG-057, T-ENG-058, T-ENG-060 |
| ENG-17 | R-ENG-076, R-ENG-104 | T-ENG-059 |
| ENG-18 | - | T-ENG-075 |
| ENG-19 | R-ENG-112 | - |
| ENG-20 | - | - |
| ENG-21 | - | - |
| ENG-22 | - | - |
| ENG-23 | - | - |
| ENG-24 | R-ENG-113 | - |
| ENG-25 | - | - |
| ENG-26 | R-ENG-092, R-ENG-095 | T-ENG-065, T-ENG-067 |
| ENG-27 | R-ENG-042, R-ENG-043, R-ENG-046 | T-ENG-031, T-ENG-033 |
| ENG-28 | R-ENG-034, R-ENG-035, R-ENG-036, R-ENG-037, R-ENG-039 | T-ENG-027, T-ENG-028 |
| ENG-29 | R-ENG-001, R-ENG-005, R-ENG-027, R-ENG-029, R-ENG-030 | T-ENG-001, T-ENG-005, T-ENG-022, T-ENG-023 |
| ENG-30 | R-ENG-015, R-ENG-041, R-ENG-062 | T-ENG-032 |
| ENG-31 | R-ENG-061, R-ENG-065 | T-ENG-046 |
| ENG-32 | R-ENG-031, R-ENG-032, R-ENG-033, R-ENG-038, R-ENG-081, R-ENG-082, R-ENG-083, R-ENG-085, R-ENG-086 | T-ENG-024, T-ENG-025, T-ENG-026, T-ENG-029, T-ENG-030 |
| ENG-33 | R-ENG-087, R-ENG-088, R-ENG-090 | T-ENG-061, T-ENG-062, T-ENG-064 |
| ENG-34 | R-ENG-047, R-ENG-048, R-ENG-049, R-ENG-050, R-ENG-052, R-ENG-053, R-ENG-068 | T-ENG-036, T-ENG-037, T-ENG-038, T-ENG-039 |
| ENG-35 | R-ENG-051, R-ENG-055 | T-ENG-041, T-ENG-042 |
| ENG-36 | R-ENG-054, R-ENG-056, R-ENG-057, R-ENG-058, R-ENG-059, R-ENG-060 | T-ENG-040, T-ENG-043, T-ENG-044, T-ENG-045 |
| ENG-37 | R-ENG-044 | T-ENG-034, T-ENG-035 |
| ENG-38 | R-ENG-066, R-ENG-067, R-ENG-069 | T-ENG-049, T-ENG-050, T-ENG-051 |
| ENG-39 | R-ENG-063, R-ENG-064 | T-ENG-047, T-ENG-048 |
| ENG-40 | R-ENG-093, R-ENG-094 | T-ENG-066 |
| ENG-41 | R-ENG-045, R-ENG-106, R-ENG-107, R-ENG-108, R-ENG-109, R-ENG-110 | T-ENG-077, T-ENG-078, T-ENG-079 |
| ENG-42 | R-ENG-098, R-ENG-099, R-ENG-100 | T-ENG-070, T-ENG-071 |
| ENG-43 | R-ENG-101, R-ENG-102 | T-ENG-072, T-ENG-073 |
| ENG-44 | R-ENG-103 | T-ENG-074 |
| ENG-45 | R-ENG-105 | T-ENG-076 |
| ENG-46 | R-ENG-116 | - |
| ENG-47 | - | T-ENG-081 |
| ENG-48 | - | - |
| ENG-49 | - | - |
| ENG-50 | R-ENG-097 | T-ENG-069 |
| ENG-51 | - | - |
| ENG-52 | - | - |
| ENG-53 | R-ENG-096 | T-ENG-068 |
| ENG-54 | R-ENG-114 | T-ENG-082 |
| ENG-55 | - | - |
| ENG-56 | - | - |
| ENG-57 | R-ENG-117, R-ENG-118 | T-ENG-084 |
| ENG-58 | - | - |
| ENG-59 | R-ENG-115 | - |
| ENG-60 | - | - |
| ENG-61 | R-ENG-078 | - |
| ENG-62 | R-ENG-120 | - |
| ENG-63 | R-ENG-125 | - |
| ENG-64 | R-ENG-126 | - |
| ENG-65 | - | T-ENG-083 |
| ENG-66 | - | T-ENG-086 |
