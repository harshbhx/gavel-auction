# Judge walkthrough

A short path through the repository for judges. Everything is PayPal sandbox only: no live PayPal call is made and no real money moves. A bid is a hold (an authorization); the held amount is not charged before capture at the hammer.

## Status at a glance

What is built and proven:

- Gates G0, G1, G2 and G4 passed on the real PayPal sandbox: app and buyers, partial capture with `final_capture`, wallet and guest card authorization, and six real webhooks verified.
- A real server process was killed once on a CI runner against the sandbox, restarted on the same data folder, and settled with one capture, two losers voided, a journal equal to PayPal and a verifying ledger (run 42558021614, `docs/evidence/server-kill/`).
- Live speech through the `/audio` socket: both providers answered 24 of 24 synthetic clips and no spoken bid was accepted without a confirm (run 42575018866, `docs/evidence/voice-live-socket/`).
- The ledger hash chain verifies (19 entries in the kill run), and the public export verifier is covered by tests.
- Hosted API checks: the webhook route answered at p95 112.03 ms from a GitHub runner against a 300 ms target (n=50), warmup after 16 minutes idle took at most 0.66 s (n=2), and the custom domains send their security headers (`docs/evidence/hosted/`, `docs/evidence/security/`).
- The judge flow is live on the hosted site: the walkthrough passed all 17 steps on 9 Nov, from `/try` through the hammer to the receipts (judge smoke run 42584326641, https://github.com/harshbhx/gavel-auction/actions/runs/42584326641). The web UI was redesigned on 7 Nov 2026 in the Scoreboard design (`docs/DESIGN.md`), and the path from `/try` through a room, a bidder join, a bid and the hammer to the receipt is built.
- More than 4,500 test cases are declared across the packages and run in CI; all eight P0 items of the security review PASS.
- The web app is hosted at https://gavel.dualmindlab.tech with its API at https://api.gavel.dualmindlab.tech, in sandbox mode, on a persistent disk. `docs/DEMO.md` lists what is available and what comes next.

Scope and limits:

- Latency is measured on the sandbox: hammer to settled p95 6.93 s against a 6 s target and hammer to captured p95 3.77 s against 2.5 s (run 42563147792, 49 of 50 completed, INCOMPLETE: 1 timeout and 3 failed capture calls); the earlier n=20 run measured 5591 ms and 3010 ms. Owner decision open: keep the targets, raise them with a reason, or reduce latency. Status PARTIAL in `docs/GATES.md`.
- G5 (speech accuracy) is PARTIAL and measured on synthetic audio: wrong accept 0.000 on 24 noise-free clips per set (tuned on those clips), and 0.058 (Groq) and 0.092 (Deepgram) on a held-out noisy set measured once (120 clips) against a pre-registered 0.05. Spoken bids always use the confirm prompt; the next step is a live or noisy room.
- G3 is a timed sandbox probe in progress since 7 Nov 2026 03:06 UTC. Day 0 is recorded and the final reading is about 12 Nov 06:17 UTC, so the result is reported then. The 30-day run is a simulation on a fake clock (`docs/evidence/SIM/SIM-MULTIDAY.md`).
- The kill ran on a CI runner, not the deployed host; the live socket run used the fake PayPal, and the web console has no audio sender yet.
- The Hugging Face datasets are published and use synthetic data by design (privacy by design).
- Next steps, with owners and dates where known, are on `docs/LIMITATIONS.md`. What changed and when is in `CHANGELOG.md`.

How to read the labels:

- The fake PayPal demo and the replay are recorded or simulated, not live PayPal. Gates G0, G1, G2 and G4 ran against the real sandbox. Committed run logs exist for G1, G2 and G4; G0 is an Actions run log.
- Settlement of a whole auction and crash recovery are covered against the fake PayPal. On the real sandbox the nightly specs R7, R8 and R10 ran (one lot of three holds, one in-process crash; runs 42200708552 and 42317068784), and 20 settlements of 6 holds were measured end to end. A real server process was killed once on a CI runner against the sandbox and recovered with one capture (run 42558021614, `docs/evidence/server-kill/`); driving a whole auction through the deployed Render server, and a kill on that host, are the next sandbox runs.
- See `docs/GATES.md` for each gate and its result.

## Real auction in two minutes (when judge rooms are on)

The hosted site offers a short real room on the PayPal sandbox with no operator key. The same steps are on the page `/try` of the web app.

1. Open https://gavel.dualmindlab.tech and press "Start a demo auction". The server opens a room that lasts about thirty minutes and takes you to the auctioneer console. If the host is busy, switched off or the flag is not set, the page says so and offers the scripted demo.
2. Open the big screen link in a second window, or scan its QR code with a phone, and join as a bidder.
3. Enter a name, pick a ceiling and approve the hold in the PayPal sandbox login. Sandbox buyer credentials: see the Devpost testing instructions. They are not in this repository.
4. Place a bid from the bidder view, then press hammer in the console.
5. You should see the hold show as held while bidding, then the settlement after the hammer and the other holds released. The audit trail link shows the ledger chained by hash.

Along the way, check these parts of the interface (each is covered by tests in CI, none by a recorded click-through of the hosted site):

- The help button (landing, join, register, bid and receipt screens) opens the hold explainer or replays the six-step guided tour; the tour also opens by itself on a first visit.
- Approving the ceiling uses a press-and-hold button (3 seconds, Space or Enter on a keyboard, with a two-tap alternative); the hold card shows hatched for held, solid for charged, hollow for released.
- On the big screen, a lot with a fundraiser goal shows a thermometer that counts only captured money.
- After the hammer the receipt can mint a share link with a QR code, and has a print layout.

For a tour that needs no login, run the web app in development (`cp packages/web/.env.example packages/web/.env.local`, then `npm run dev -w @gavel/web`) and open `/r/demo/screen?scripted=1`; it replays a recorded room in the browser and makes no PayPal calls. Only development builds honour `scripted=1`: on the hosted site a production build ignores it. To try the scripted demo on the hosted site, open `/demo/scripted` (the "Watch the guided tour" link on `/try` goes there): it plays the recorded room in the tab with no server connection. Nothing on this path is a live-money action: the host refuses to start judge rooms unless it is on the PayPal sandbox.

To call the API directly (curl or a client) with a judge key, see [Call the API as a judge](https://docs.gavel.dualmindlab.tech/docs/judges/call-the-api): per-key room cap, hourly cap and expiry, an HTTP bid route, and a Try it panel. A key never opens an operator route.

## Five minute path

The table below is the manual path a judge follows by hand. A separate automated check, the nightly smoke, walks the same journey on the public site; its own step numbers (1 to 17) are not the numbers in this table.

The web app is hosted (see `docs/DEMO.md`). The nightly `.github/workflows/judge-smoke.yml` runs the live journey walk (the script under `qa/`) in smoke mode against the public domains (workflow inputs `web_url` and `api_url`, defaults `https://gavel.dualmindlab.tech` and `https://api.gavel.dualmindlab.tech`): open `/try`, start a demo room, open the hub, join by code and from the hub link, register with the demo hold, bid from two bidders, close the lot, open the screen and the receipt. One room per run, every step is listed as PASS or FAIL in the job summary, and the job fails when any step fails. An earlier run on 9 Nov 2026 (https://github.com/harshbhx/gavel-auction/actions/runs/42561627128) failed step 16 (hammer); the fix (issue #2208, PR #2209) is merged, and the run of 9 Nov 08:13 UTC (https://github.com/harshbhx/gavel-auction/actions/runs/42584326641) passed all 17 steps. The judge-smoke run list in Actions shows the latest result. Steps 3 to 5 of the table above are covered by the smoke only through its own steps; the older `packages/e2e/specs/judge-walkthrough.spec.ts` covers steps 1 and 2 on the fake stack.

| Step | Persona    | What to do                                          | Expected outcome                                                                                         |
| ---- | ---------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | Judge      | Open the hosted web URL.                            | The landing page shows a heading and the "Start a demo auction" button.                                  |
| 2    | Judge      | Press "Start a demo auction".                       | A demo auction opens with a link for each role: big screen, auctioneer console, bidders and audit trail. |
| 3    | Auctioneer | Open the auctioneer console link.                   | The console shows the lot and its controls.                                                              |
| 4    | Bidder     | Open a bidder link in a second tab and place a bid. | The bid shows on the big screen. A bid is a hold; nothing is charged.                                    |
| 5    | Auditor    | Open the audit trail link.                          | The ledger entries show, chained by hash.                                                                |

Where to look afterwards:

- Quality report: the `quality-report` artifact of the latest `.github/workflows/report.yml` run in GitHub Actions (https://github.com/harshbhx/gavel-auction/actions/workflows/report.yml); its page names the commit it was built from. It is not served from the hosted site.
- Version: `GET /version` on the API host returns the deployed commit; compare it with the commit the report names.
- Audit export: the audit trail link in step 5, and the verification steps below.

Steps 3 and 4 depend on the web UI; the nightly smoke exercises the hub, join, bid and hammer path, and the spec `judge-walkthrough.spec.ts` covers steps 1 and 2 only.

## Run the fake-PayPal demo

1. Follow the "Quick start" section of `README.md` (Node 22 and npm; run `npm ci` before the server). Its `TOKEN_SECRET` and `ADMIN_KEY` values are generated with `openssl rand`, because the server refuses short ones.
2. Start the server with `PAYMENTS=fake`. The built-in fake PayPal answers every call, so no network access and no PayPal account are needed. Production mode refuses fake payments.
3. For the web part, copy `packages/web/.env.example` to `packages/web/.env.local` and run `npm run dev -w @gavel/web`; `docs/DEMO.md` has the routes to open.

The fake PayPal is a test double. Behaviour seen there says nothing about the real PayPal sandbox; the gate evidence below does.

## Read the evidence

- `docs/GATES.md`: the gates, what each proves, and its result (PASS, FAIL or NOT RUN).
- `docs/evidence/<gate>/`: raw sandbox run logs as JSON lines. Tokens, buyer emails and payer IDs are replaced by `[REDACTED]`.
- `docs/PUBLIC-REPO-CHECKLIST.md`: what was checked before the repository was made public, and the known limits.

## Verify the replay bundle

A replay bundle (`packages/shared/src/replay-bundle.ts`, `REPLAY_BUNDLE_VERSION` 1) carries a public export of the auction ledger. The public export is a redacted hash chain; `verifyPublicExport` in `@gavel/engine` (`packages/engine/src/ledger/public-export.ts`) checks its version, sequence numbers, links and hashes and returns `{ ok: true }` or the first bad index and the reason (`bad_hash`, `bad_prev`, `bad_seq`, `bad_version` or `truncated`).

1. Take the public export entries from the bundle.
2. Call `verifyPublicExport(entries)`. Pass `expectedHead` (`{ seq, hash }`) to also detect a truncated chain.
3. Any edit to an entry makes the result `ok: false` at the edited index.

`packages/engine/test/public-export.test.ts` shows working calls, including tampered and truncated chains.

## Clean clone check

The `clean-clone` workflow (`.github/workflows/clean-clone.yml`) checks a fresh checkout each week: install, typecheck, shared and engine unit tests, the scenario tests, and `scripts/clean-clone-check.mjs` (license, run instructions, no tracked env or key files, required docs).
