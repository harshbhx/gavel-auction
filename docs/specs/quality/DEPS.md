# DEPS: quality area (QA-)

Cross-area keys written without numbers (ENG-types, ENG-ledger, PAY-fake, PAY-client, PAY-saga, PAY-webhook, PAY-gates, VOI-pipeline, RT-shared-wire, RT-room, RT-server, RT-auth, RT-persist, WEB-bidder, WEB-console, WEB-demo) are placeholders for the interface or implementation issue of that area; the orchestrator maps them to real keys. QA issues never block another area's wave 1.

## Wave 1 (start immediately, no dependencies, no keys)

QA-01, QA-02, QA-03, QA-04, QA-05, QA-06, QA-07, QA-08, QA-10, QA-11, QA-13, QA-15, QA-21, QA-24, QA-51, QA-54

Unblocks: QA-01 -> QA-12, QA-14, QA-32; QA-51 (ci.yml) -> QA-09, QA-50, QA-60; QA-21 (DSL types) -> QA-22 -> every scenario issue (QA-27..QA-31, QA-33..QA-35); QA-24 (fixtures) -> QA-25, QA-28, QA-47; QA-15 (property harness) -> QA-16..QA-19.

## Chains

- Scenarios: QA-21 -> QA-22 (inproc) -> QA-27, QA-28, QA-30, QA-33, QA-34, QA-35; QA-22 -> QA-23 (stack, needs QA-32) -> QA-29, QA-31, QA-37 -> QA-38, QA-39, QA-40, QA-43.
- Real sandbox: PAY-client + PAY-gates -> QA-44 -> QA-45, QA-46; QA-24 -> QA-47 (G5).
- Infra: QA-59 -> QA-60 -> QA-61, QA-63, QA-64; QA-60 + QA-61 -> QA-62.
- Reports and submission: QA-14 -> QA-57 -> QA-58 -> QA-69; QA-37 -> QA-67 -> QA-68; QA-54 + QA-08 -> QA-71; QA-68, QA-69, QA-70, QA-71, QA-43 -> QA-72.

## Needs Harsh or Dhairya (label blocked:needs-harsh)

QA-09 (apply protection), QA-25, QA-44, QA-45, QA-46, QA-47 (sandbox and STT keys), QA-59 (environments), QA-60, QA-61, QA-63 (hosting accounts, webhook registration), QA-68, QA-71, QA-72 (video, visibility flip, submit).

## All issues (key, wave, depends on, title)

| Key | Wave | Depends on | Title |
|---|---|---|---|
| QA-01 | 1 | - | Root workspace skeleton, tsconfig.base and package manifests |
| QA-02 | 1 | - | ESLint flat config and Prettier at the root |
| QA-03 | 1 | - | Dependency direction rules and engine purity lint |
| QA-04 | 1 | - | commitlint, husky and lint-staged |
| QA-05 | 1 | - | Branch name and PR title validator |
| QA-06 | 1 | - | CODEOWNERS and path-ownership checker |
| QA-07 | 1 | - | PR template and issue templates |
| QA-08 | 1 | - | CONTRIBUTING, SECURITY and CODE_OF_CONDUCT |
| QA-09 | 2 | QA-51 | Branch protection, required checks and dependency update policy |
| QA-10 | 1 | - | docs/DECISIONS.md and docs/GATES.md with format linter |
| QA-11 | 1 | - | ASCII and banned-word checks |
| QA-12 | 2 | QA-01 | api-extractor reports and the interface label policy |
| QA-13 | 1 | - | ESLint no-real-time and no-random rules for tests |
| QA-14 | 2 | QA-01 | Vitest workspace projects and per-package coverage gates |
| QA-15 | 1 | - | Property-test harness: fast-check config, seed printing, regression fixtures |
| QA-16 | 2 | QA-15, ENG-types | Property suite: engine invariants |
| QA-17 | 2 | QA-15, ENG-types | Property suite: money and ledger replay |
| QA-18 | 3 | QA-15, PAY-fake, PAY-saga | Property suite: saga invariants under random fault schedules |
| QA-19 | 2 | QA-15, RT-shared-wire | Property and fuzz suite: wire messages |
| QA-20 | 3 | QA-14 | Stryker mutation testing for engine and saga |
| QA-21 | 1 | - | Scenario DSL types, schema and YAML loader |
| QA-22 | 2 | QA-21, ENG-types, PAY-fake, RT-room | Scenario runner: in-process mode |
| QA-23 | 3 | QA-22, QA-32 | Scenario runner: stack mode with process control |
| QA-24 | 1 | - | Fixtures: layout, validator, recorded STT results, 24 noisy audio clips |
| QA-25 | 2 | QA-24 | Webhook and sandbox response fixtures (redacted) |
| QA-26 | 3 | QA-25, PAY-fake, PAY-client | Contract tests: fake PayPal vs real client schemas |
| QA-27 | 3 | QA-22 | Scenarios S01 happy path, S04 duplicate webhooks, S05 out-of-order webhooks |
| QA-28 | 3 | QA-22, QA-24, VOI-pipeline | Scenario S02 voice replay |
| QA-29 | 4 | QA-23, PAY-saga | Scenario S03 crash and resume at six checkpoints |
| QA-30 | 3 | QA-22 | Scenarios S06, S07, S08 runner-up fallback and all-holds-invalid |
| QA-31 | 4 | QA-23 | Scenarios S09 reconnect and S15 restart with persisted ledger |
| QA-32 | 2 | QA-01 | Playwright config: projects, shards, retries, traces |
| QA-33 | 3 | QA-22, RT-room | Scenario S10 abusive input |
| QA-34 | 3 | QA-22 | Scenarios S11 race and S12 soft close |
| QA-35 | 3 | QA-22, PAY-saga | Scenarios S13 capture 5xx and S14 void failure |
| QA-36 | 2 | PAY-client | Sandbox-only guard tests and live-host CI grep |
| QA-37 | 4 | QA-32, QA-27, WEB-bidder, WEB-console | Playwright specs: full auction happy path and cross-browser matrix |
| QA-38 | 4 | QA-37 | Visual regression baselines |
| QA-39 | 4 | QA-37 | Accessibility: axe sweep over all views and states |
| QA-40 | 4 | QA-37 | Accessibility: keyboard, live regions and projected-screen legibility |
| QA-41 | 4 | QA-39 | Manual accessibility pass and docs/A11Y.md |
| QA-42 | 4 | QA-32 | Flake tracking and quarantine automation |
| QA-43 | 4 | QA-37, WEB-demo | Judge walkthrough spec and docs/JUDGES.md |
| QA-44 | 3 | PAY-client, PAY-gates | Real-sandbox specs R1-R4 (gate-tagged) |
| QA-45 | 4 | QA-44 | Real-sandbox specs R5-R8 |
| QA-46 | 4 | QA-44 | Nightly sandbox workflow and result summary |
| QA-47 | 2 | QA-24 | G5 harness: 20 noisy utterances through live STT and parser |
| QA-48 | 4 | RT-room | Load harness and L1 100-bidder run, L2 identical-bid race |
| QA-49 | 4 | QA-48 | Load L3 hammer race, L4 webhook storm, 30 minute soak |
| QA-50 | 4 | QA-51 | Security review checklist and tracker (docs/SECURITY-REVIEW.md) |
| QA-51 | 1 | - | CI workflow ci.yml with required jobs and sharding |
| QA-52 | 3 | RT-auth | Security tests: access control and identity (SEC-01, SEC-02, SEC-18) |
| QA-53 | 3 | PAY-webhook | Security tests: webhook authenticity and SSRF (SEC-03, SEC-13) |
| QA-54 | 1 | - | Secret scanning: gitleaks config, history scan, bundle and log scans |
| QA-55 | 4 | RT-auth | Security tests: fuzz, origins and headers (SEC-07, SEC-09, SEC-10) |
| QA-56 | 4 | VOI-pipeline | Security tests: dependency audit, parser DoS, call caps (SEC-12, SEC-14) |
| QA-57 | 3 | QA-14 | Report builder: summary.json, HTML page and count targets |
| QA-58 | 4 | QA-57, QA-60 | Publish /quality report and report.yml |
| QA-59 | 2 | RT-server | Boot validation, .env.example and environments |
| QA-60 | 3 | QA-59, QA-51 | Deploy API and WebSocket host to Render with deploy-staging.yml |
| QA-61 | 4 | QA-60 | Deploy web to Cloudflare Pages (or Render static) |
| QA-62 | 4 | QA-60, QA-61 | deploy-prod.yml with reviewer gate, version endpoint and rollback |
| QA-63 | 4 | QA-60 | Register the webhook URL in the sandbox app and post-deploy smoke |
| QA-64 | 4 | QA-60 | Uptime probe, /warmup and alerting |
| QA-65 | 4 | ENG-ledger, RT-persist | Ledger export endpoint and daily backup workflow |
| QA-66 | 4 | RT-server | Structured logs, metrics and the /ops page |
| QA-67 | 4 | QA-37 | Video script, shot list and real-vs-recorded label sheet |
| QA-68 | 4 | QA-67, QA-62 | Record, edit, caption and upload the video |
| QA-69 | 4 | QA-58 | Devpost write-up |
| QA-70 | 4 | QA-37, WEB-demo | Screenshots workflow and architecture diagram |
| QA-71 | 4 | QA-54, QA-08 | Public-repo checklist, clean-clone job and judge docs |
| QA-72 | 4 | QA-68, QA-69, QA-70, QA-71, QA-43 | Final submission checklist, docs/SUBMISSION.md and submit gate |

## Coverage: requirement id to issue key

| Requirement | Issues |
|---|---|
| R-QA-001 | QA-01 |
| R-QA-002 | QA-01, QA-03 |
| R-QA-003 | QA-01 |
| R-QA-004 | QA-02 |
| R-QA-005 | QA-04 |
| R-QA-006 | QA-04 |
| R-QA-007 | QA-05 |
| R-QA-008 | QA-09, QA-51 |
| R-QA-009 | QA-06 |
| R-QA-010 | QA-07 |
| R-QA-011 | QA-07 |
| R-QA-012 | QA-08 |
| R-QA-013 | QA-06 |
| R-QA-014 | QA-12 |
| R-QA-015 | QA-10 |
| R-QA-016 | QA-10 |
| R-QA-017 | QA-11 |
| R-QA-018 | QA-01, QA-09 |
| R-QA-020 | QA-14, QA-57 |
| R-QA-021 | QA-14 |
| R-QA-022 | QA-13 |
| R-QA-023 | QA-15, QA-16, QA-17, QA-18, QA-19 |
| R-QA-024 | QA-20 |
| R-QA-025 | QA-21, QA-22, QA-23, QA-37 |
| R-QA-026 | QA-22, QA-27, QA-28, QA-29, QA-30, QA-31, QA-33, QA-34, QA-35, QA-36 |
| R-QA-027 | QA-18, QA-23, QA-29 |
| R-QA-028 | QA-25, QA-26 |
| R-QA-029 | QA-44, QA-45, QA-46, QA-47 |
| R-QA-030 | QA-34, QA-48, QA-49 |
| R-QA-031 | QA-32, QA-37 |
| R-QA-032 | QA-57, QA-58 |
| R-QA-033 | QA-32, QA-42 |
| R-QA-034 | QA-38 |
| R-QA-035 | QA-24, QA-25 |
| R-QA-036 | QA-33, QA-50, QA-52, QA-53, QA-54, QA-55, QA-56 |
| R-QA-037 | QA-39, QA-40, QA-41 |
| R-QA-038 | QA-36 |
| R-QA-039 | QA-54 |
| R-QA-040 | QA-46, QA-48, QA-51, QA-60 |
| R-QA-041 | QA-32, QA-51 |
| R-QA-042 | QA-60, QA-61, QA-62 |
| R-QA-043 | QA-59 |
| R-QA-044 | QA-63 |
| R-QA-045 | QA-64 |
| R-QA-046 | QA-65 |
| R-QA-047 | QA-66 |
| R-QA-048 | QA-64 |
| R-QA-049 | QA-62 |
| R-QA-050 | QA-67, QA-68 |
| R-QA-051 | QA-69 |
| R-QA-052 | QA-70 |
| R-QA-053 | QA-71 |
| R-QA-054 | QA-72 |
| R-QA-055 | QA-43 |

## Coverage: test id to issue key

| Test | Issues |
|---|---|
| T-QA-001 | QA-01, QA-02, QA-14, QA-51 |
| T-QA-002 | QA-03 |
| T-QA-003 | QA-03 |
| T-QA-004 | QA-04 |
| T-QA-005 | QA-05 |
| T-QA-006 | QA-09 |
| T-QA-007 | QA-06 |
| T-QA-008 | QA-12 |
| T-QA-009 | QA-10 |
| T-QA-010 | QA-11 |
| T-QA-011 | QA-07 |
| T-QA-012 | QA-04 |
| T-QA-020 | QA-13 |
| T-QA-021 | QA-16 |
| T-QA-022 | QA-17 |
| T-QA-023 | QA-17 |
| T-QA-024 | QA-18 |
| T-QA-025 | QA-19 |
| T-QA-026 | QA-20 |
| T-QA-027 | QA-21, QA-22, QA-23 |
| T-QA-028 | QA-26 |
| T-QA-029 | QA-24 |
| T-QA-030 | QA-27 |
| T-QA-031 | QA-28 |
| T-QA-032 | QA-29 |
| T-QA-033 | QA-27 |
| T-QA-034 | QA-27 |
| T-QA-035 | QA-30 |
| T-QA-036 | QA-30 |
| T-QA-037 | QA-31 |
| T-QA-038 | QA-33 |
| T-QA-039 | QA-34 |
| T-QA-040 | QA-36 |
| T-QA-041 | QA-34 |
| T-QA-042 | QA-35 |
| T-QA-043 | QA-35 |
| T-QA-044 | QA-31 |
| T-QA-045 | QA-32, QA-37 |
| T-QA-046 | QA-38 |
| T-QA-047 | QA-39, QA-40 |
| T-QA-048 | QA-40 |
| T-QA-049 | QA-43 |
| T-QA-050 | QA-44 |
| T-QA-051 | QA-44 |
| T-QA-052 | QA-44 |
| T-QA-053 | QA-44 |
| T-QA-054 | QA-45 |
| T-QA-055 | QA-45 |
| T-QA-056 | QA-45 |
| T-QA-057 | QA-45 |
| T-QA-058 | QA-46 |
| T-QA-059 | QA-47 |
| T-QA-060 | QA-48 |
| T-QA-061 | QA-48 |
| T-QA-062 | QA-49 |
| T-QA-063 | QA-49 |
| T-QA-064 | QA-49 |
| T-QA-070 | QA-52 |
| T-QA-071 | QA-52 |
| T-QA-072 | QA-53 |
| T-QA-073 | QA-54 |
| T-QA-074 | QA-55 |
| T-QA-075 | QA-55 |
| T-QA-076 | QA-55 |
| T-QA-077 | QA-56 |
| T-QA-078 | QA-56 |
| T-QA-079 | QA-52 |
| T-QA-080 | QA-59 |
| T-QA-081 | QA-66 |
| T-QA-082 | QA-62 |
| T-QA-083 | QA-60, QA-63 |
| T-QA-084 | QA-64 |
| T-QA-085 | QA-65 |
| T-QA-086 | QA-57 |
| T-QA-087 | QA-68 |
| T-QA-088 | QA-54, QA-71 |
| T-QA-089 | QA-72 |
