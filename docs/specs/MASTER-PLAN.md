# MASTER-PLAN: GAVEL work breakdown, waves and schedule

Deadline: 2026-11-12 12:00 PST (2026-11-13 01:30 IST). Target submit: 2026-11-12 04:00 PST. Today: 2026-11-04 (D1).
Areas and key prefixes: ENG (engine), PAY (payments), RT (realtime and shared), VOI (voice), WEB (frontend), QA (quality, infra, submission).
Cross-area keys are named by topic below; real numbers come from each area's issues file.

## 1. Rules of the road

1. One issue, one branch, one PR, one owner. Branch `<type>/<KEY>-slug`; title starts with the key (QA-05, QA-06).
2. Interface-first: the first issue of every package publishes types, a fake or in-memory implementation and fixtures. Implementations and consumers start after it merges. Changes to `@gavel/shared` exports go in their own `interface`-labelled PR (QA-12).
3. File ownership is exclusive (CODEOWNERS, QA-06). `packages/shared` and `packages/server` are owned by realtime; `packages/e2e`, `infra/`, `.github/` by quality.
4. Everything external sits behind an interface with a fake. No developer needs a PayPal or STT key to be productive; only gate issues and nightly sandbox work do.
5. Heavy work runs in GitHub Actions only (QA-51). Locally: typecheck, lint on changed files, one package's unit tests.
6. A gate result that contradicts the plan produces a DECISIONS.md entry and a stated fallback in the same PR (QA-10).
7. Freeze: D8 12:00 IST. After it only P0 and bug fixes merge.
8. Merge order inside a wave: types and fakes first, then implementations, then integration, then polish.

## 2. Wave plan

### Wave 1: start now, no dependencies, no keys (all parallel)

| Area | Issues (topic) |
|---|---|
| QA | QA-01 workspace skeleton; QA-02 lint and format; QA-03 dependency rules; QA-04 commit hooks; QA-05 branch and PR title check; QA-06 CODEOWNERS; QA-07 templates; QA-08 contributing guide; QA-10 DECISIONS and GATES; QA-11 ASCII and word checks; QA-13 test lint rules; QA-15 property harness; QA-21 scenario DSL types; QA-24 audio and bid fixtures; QA-51 ci.yml; QA-54 secret scanning |
| ENG | engine types and interfaces (Clock, Ledger, Engine, Money), port of reference engine and its tests, ledger model, config types |
| PAY | PayPal client interface and types, fake PayPal server with fault hooks, settlement state machine types, webhook verifier interface, gate issues G1-G4 (need sandbox keys: Harsh) |
| RT | `@gavel/shared` ids, money, time, zod schemas, wire message types, error codes (must land first in the day); room host skeleton; persistence interface with in-memory adapter |
| VOI | audio framing, STT adapter interface and stub, bid parser and validator port with labelled utterances, browser mic capture |
| WEB | app shell, design tokens, routing, WS client over shared wire types with a mock server, page skeletons |

All wave-1 PRs touch disjoint paths. The only shared choke point is `@gavel/shared`; RT lands it in the first two hours of D1 and every other area codes against it from D1 evening.

### Wave 2: needs wave-1 interfaces (D2-D3)

QA-12 api reports; QA-14 coverage gates; QA-22 in-process scenario runner; QA-25 sandbox fixtures; QA-26 contract tests; QA-32 Playwright config; QA-36 sandbox-only guard tests; QA-47 G5 harness; QA-57 report builder; QA-59 boot validation; QA-60 staging deploy; QA-61 web deploy; QA-63 webhook registration; QA-16, QA-17, QA-19 property suites. ENG: modes, soft close, runner-up, property tests. PAY: real client, capture, void, saga, webhook receiver. RT: room with single-writer engine, reconnect, auth. VOI: STT adapters, parse with validator, confirm flow. WEB: registration, bidder UI, console.

### Wave 3: integration (D4-D6)

QA-23 stack runner; QA-27..QA-31, QA-33..QA-35 scenario files; QA-18 saga properties; QA-37 browser specs; QA-44 real-sandbox R1-R4; QA-46 nightly workflow; QA-52, QA-53 security tests; QA-62 prod deploy and rollback. Cross-area: end-to-end wiring of room, engine, saga and voice; settlement UI; audit view; replay mode.

### Wave 4: polish, hardening, submission (D6-D9)

QA-20 mutation; QA-38 visual; QA-39..QA-41 accessibility; QA-42 flakes; QA-43 judge walkthrough; QA-45 sandbox R5-R8; QA-48, QA-49 load; QA-50 security review; QA-55, QA-56 security tests; QA-58 /quality page; QA-64 uptime; QA-65 export and backup; QA-66 observability; QA-67..QA-72 video, Devpost, screenshots, public repo, submit.

## 3. Day-by-day schedule

Times are IST unless stated. Each day ends with a green `main` and a short entry in docs/DECISIONS.md if anything changed.

### D1 Wed Nov 4 (gates and skeleton)
- Morning: RT lands `@gavel/shared` types. QA-01, QA-02, QA-06, QA-10, QA-51 land so CI exists by midday. Harsh or Dhairya creates the sandbox app and buyers (PAY gate prerequisites).
- Afternoon: gates G1-G4 run (PAY), G5 harness data recorded (QA-24, voice). Engine port in progress. QA-03, QA-04, QA-05, QA-07, QA-08, QA-11, QA-13, QA-15, QA-21, QA-54 land.
- Exit: CI required checks green on an empty skeleton; GATES.md has results or NOT RUN with reasons; go/no-go on G1 and G2 recorded. If G1 or G2 fails with no workaround, switch to wallet-only buyers or stop and pick the alternative idea (decision D-0010).

### D2 Thu Nov 5 (engine, room, mic)
- Engine and ledger merged with property tests (QA-16, QA-17). Room host with in-memory store. Mic capture and streaming STT adapter. QA-14 coverage gates, QA-32 Playwright config, QA-22 inproc runner begin.
- Optional early eligibility check submitted.
- Exit: S01 scenario runs in-process against engine and fake PayPal.

### D3 Fri Nov 6 (payments saga, registration)
- PayPal client, capture, void, saga with failure injection. Registration with ceiling presets and QR bid UI. QA-26 contract tests, QA-36 sandbox guard, QA-57 report builder, QA-59 boot validation, QA-60 staging deploy, QA-63 webhook registered.
- Exit: S04, S05, S13, S14 pass in-process; staging URL live with health check.

### D4 Sat Nov 7 (console, public screen, confirm flow)
- Auctioneer console, public screen, parse and confirm, audit view. QA-23 stack runner; QA-27, QA-28, QA-30 scenarios; QA-61 web deploy.
- Exit: S01, S02, S06 pass in stack mode in Chromium.

### D5 Sun Nov 8 (integration and crash tests)
- End-to-end integration. QA-29 crash and resume at six checkpoints, QA-31 reconnect and restart, QA-33 abusive input, QA-34 race, QA-35 faults, QA-37 browser matrix, QA-44 real-sandbox specs, QA-46 nightly, QA-52 and QA-53 security tests.
- Exit: first full nightly run green or inconclusive with reasons; all 16 scenarios pass inproc.

### D6 Mon Nov 9 (polish, ladder UI, replay)
- Design polish, authorization-state ladder UI, replay mode. QA-38 visual baselines, QA-39 and QA-40 accessibility, QA-42 flakes, QA-45 sandbox R5-R8, QA-55 and QA-56 security tests, QA-65 export, QA-66 observability, QA-67 video script finalised.
- Exit: feature-complete candidate tagged v0.9 by 18:00; coverage gates all green.

### D7 Tue Nov 10 (deploy, docs, load)
- Production deploy and rollback rehearsal (QA-62), uptime (QA-64), /quality published (QA-58), load runs (QA-48, QA-49), judge walkthrough and docs (QA-43), security review completed (QA-50), manual accessibility pass (QA-41), README and run instructions.
- Exit: a teammate completes docs/JUDGES.md path on production in under 5 minutes; SECURITY-REVIEW has no open P0.

### D8 Wed Nov 11 (video, text, freeze)
- Freeze at 12:00 IST. Record on the tagged build (QA-68), Devpost text (QA-69), screenshots and diagram (QA-70), public-repo checklist run and visibility flip in the evening (QA-71). Always-on hosting enabled.
- Exit: video uploaded public and under 3:00; Devpost saved as draft.

### D9 Thu Nov 12 (final fixes and submit; deadline 12:00 PST = Nov 13 01:30 IST)
- Only P0 and bug fixes. Tag v1.0, deploy-prod, run checklist (QA-72), submit by 04:00 PST (17:30 IST) at the latest, then verify as a signed-out visitor. Remaining time is buffer, not work time.

## 4. Critical path and risks

Critical path: shared types -> engine -> room -> saga -> stack runner -> crash scenario S03 -> video segment 2:05. The slack is about one day; keep QA-23 and QA-29 staffed.

| Risk | Trigger | Response |
|---|---|---|
| G1 or G2 fails | D1 evening | decision D-0010: wallet-only buyers, or stop |
| Shared types churn | after D1 noon | only `interface` PRs, reviewed by RT owner within 1 hour |
| Sandbox outage | during nightly or recording | scenarios on the fake carry the proof; label recorded segments on screen |
| STT accuracy below target (G5) | D1-D2 | lean on confirm-on-ambiguity; keep replay mode as the demo path |
| Render cold starts | D7 on | always-on instance or 4-minute keep-alive (QA-64) |
| Video overruns | D8 | cut rows 1 and 8 of the shot list first, never hammer or crash segments |
| Capacity | any day | cut list in order: LLM-bidder chart, NFC, second-price mode UI, AG Grid, visual regression, mutation testing. Never cut: gate evidence, audit trail, replay mode, tests, video |

## 5. Definition of ready and done (all areas)

Ready: issue has Spec, Files, Depends on, test ids, size under 4 hours, all dependencies merged.
Done: PR merged by squash, `ci / required` green, tests named in the Test plan exist and pass, docs updated, DECISIONS entry if a contract changed, no secrets, ASCII only.
