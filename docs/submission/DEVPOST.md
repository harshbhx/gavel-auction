# GAVEL: Devpost draft

Draft text for the Devpost entry. Refs #99 and #321. The owner finalizes it: numbers from the /quality page, the tools and models list the Devpost form asks for, the reuse statement and the links are filled in by the owner and are marked OWNER below. Everything here is checked against `docs/GATES.md` and the code on main at the time of writing. PayPal sandbox only: no live charge is made anywhere in this project.

## Tagline

Every bid is a PayPal hold. The hammer is the payment.

## The problem

In a live auction or a fundraiser, bidders hesitate when a card is charged up front, so they bid less or do not bid. The other way round, bids are unsecured: a winner can walk away after the hammer and the organizer chases payment afterwards. Paper sheets and shouted bids make the record hard to trust. We do not quote a non-payment rate, because we found no data we can stand behind.

## The solution

GAVEL makes each bid a PayPal AUTHORIZE hold.

- A bidder approves a ceiling (the most they may bid) as an authorization hold. It is a promise, not a charge.
- A deterministic engine runs an ascending English auction (minimum increment, soft close). Bids above a bidder's ceiling are refused.
- At the hammer GAVEL captures only the winning price from the winner's hold. Every other hold is voided or released. Money is not charged before the capture.
- Settlement is a journaled saga designed to resume after a crash without a second capture. It is exercised on the project's own fake PayPal server and on the specific real-sandbox pieces listed in `docs/GATES.md`; no whole-auction settlement or crash run has been done on the sandbox, and the nightly sandbox run has two recorded real runs on the sandbox (runs 42200708552 and 42317068784, specs R7, R8 and R10; `docs/evidence/nightly`) and is skipped when its secrets are absent. If PayPal's answer to a capture is unknown, settlement stops for review rather than guessing.
- Every accepted bid goes into a deterministic, hash-chained ledger, so the audit trail can be re-verified by anyone holding the export.
- Voice bids: a spoken bid is turned into a structured bid by a parser with a deterministic validator. Ambiguous bids go through a confirm gate ("Did you mean 350 for paddle 12?"). The parser never decides a winner and never moves money. Typed entry and QR bids are the other input paths, so the auction still works if speech fails.

## How it is built

A TypeScript monorepo (npm workspaces, Node 22), with a Python reference implementation used for differential tests of the engine and the parser.

| Package             | Job                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/engine`   | Auction rules, commands and events, hash-chained ledger, replay                                                  |
| `packages/payments` | PayPal Orders v2 and Payments v2 client, hold service, settlement saga, webhook verification, fake PayPal server |
| `packages/server`   | Room and runtime service, HTTP routes, file stores, admin and ops                                                |
| `packages/voice`    | Audio capture, speech-to-text clients, bid parser, replay of recorded audio                                      |
| `packages/web`      | Bidder, auctioneer console, big screen, audit and replay screens                                                 |
| `packages/shared`   | Money, ids, wire types and contracts shared by the others                                                        |
| `packages/e2e`      | Property tests, sandbox specs, gate runners                                                                      |

Real PayPal sandbox gates (see `docs/GATES.md`, evidence files under `docs/evidence`):

| Gate | Question                                                                      | Status on main                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0   | Sandbox connectivity                                                          | PASS in `docs/GATES.md`, backed only by a GitHub Actions run log (no `docs/evidence/G0/` file is committed)                                                                                                                                                                                                                                             |
| G1   | Authorize 500, capture 350 with final_capture: is the 150 remainder released? | PASS for two PayPal-account buyers (2026-11-04, 2026-11-05; the "card" buyer is a PayPal account funded by a card, not a guest card checkout). The authorization reads CAPTURED after the final capture and an explicit void answers 422 PREVIOUSLY_CAPTURED; release of the remainder is inferred                                                      |
| G2   | Card and guest AUTHORIZE in the JS SDK v6                                     | PASS (2026-11-05): wallet and guest card both authorized, HTTP 201                                                                                                                                                                                                                                                                                      |
| G3   | Honor period versus validity, and reauthorize                                 | Real probe in progress (day 0 7 Nov 2026 03:06 UTC, checkpoints at 3.5, 4 and 5 days, final about 12 Nov 06:17 UTC); `docs/GATES.md` reads NOT RUN / IN PROGRESS                                                                                                                                                                                        |
| G4   | Webhook signature verification on real events                                 | PASS (2026-11-05): 6 real deliveries each verified SUCCESS                                                                                                                                                                                                                                                                                              |
| G5   | Speech-to-text accuracy on noisy bids                                         | PARTIAL on synthetic, noise-free speech, two sets of 24 clips (eSpeak and a human-like voice): Deepgram nova-3 and Groq whisper-large-v3-turbo wrong-accept 0.000 against a 0.05 limit (was 0.083 to 0.167 on the first run), after fixes chosen on those same clips. Spoken bids always go through the confirm prompt. No real-room or noisy-room test |

## What is real versus simulated

| Part                                                         | Real                                                                                                                                                                           | Simulated or recorded                                                                                                                                                                                                                                  | Source         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| Authorize, capture 350 with final_capture, remainder release | Authorization reads CAPTURED after the final capture on the PayPal sandbox, for a wallet and a card-funded PayPal account; remainder release inferred                          | Tests of the saga run against the project's fake PayPal                                                                                                                                                                                                | G1 evidence    |
| Card and guest AUTHORIZE                                     | Observed on the sandbox in SDK v6                                                                                                                                              | n/a                                                                                                                                                                                                                                                    | G2 evidence    |
| Webhook signature verification                               | 6 real sandbox events verified through PayPal's endpoint                                                                                                                       | Tampered-event rejection and the retry schedule are tested against the fake only                                                                                                                                                                       | G4 evidence    |
| Honor period and reauthorize                                 | Real probe in progress (G3, final about 12 Nov 06:17 UTC); simulated, not real: 30 days of auctions on a fake clock                                                            | Simulated: We simulated 30 days of auctions with a fake clock: holds, honor-period expiry, reauthorization, crashes and recovery, with the ledger balancing to the cent ([SIM-MULTIDAY](../evidence/SIM/SIM-MULTIDAY.md); simulated, not real PayPal). | G3 pending     |
| Settlement of a whole auction (many holds, crash and resume) | Not run end to end on the sandbox                                                                                                                                              | Run against the fake PayPal, in tests                                                                                                                                                                                                                  | saga tests     |
| Speech-to-text accuracy                                      | PARTIAL: wrong-accept 0.000 on two sets of 24 synthetic, noise-free clips after fixes chosen on those clips (first run 0.083 to 0.167); confirm prompt kept; no real-room test | Parser measured on text transcripts only: 169 cases, wrong accepts 0.000                                                                                                                                                                               | G5-text        |
| Demo replay                                                  | n/a                                                                                                                                                                            | A recorded auction played back read only, labelled "Recorded" on screen                                                                                                                                                                                | replay player  |
| Hosted demo                                                  | OWNER: state the real deployed status when it is known                                                                                                                         |                                                                                                                                                                                                                                                        | `docs/DEMO.md` |
| Money                                                        | No real money moves anywhere. All PayPal calls are sandbox                                                                                                                     |                                                                                                                                                                                                                                                        | all            |

Latency is the open risk. Sandbox void p95 is 1235.96 ms (n=10 per call, 2026-11-05), above the 1 s per-call budget the 6 s SETTLED target assumes. The target is not shown to hold, and the run log is not committed. See `docs/GATES.md`.

## Challenges and what we learned

- Sandbox account region. The sandbox accounts must be US accounts. PayPal rejects INR orders for sandbox buyers with 422 CURRENCY_NOT_SUPPORTED, and India sandbox buyers fail at the approval page with USD. Gates now send USD.
- Authorization validity. PayPal documents an honor period and a validity window that disagree across pages (3 days versus 29 days, with one reauthorization). Our G3 real probe (day 0 7 Nov 2026 03:06 UTC, final about 12 Nov 06:17 UTC) is measuring this; the 29-day figure has not been verified in the real sandbox. Until it reports, we design the demo so holds are created minutes before the capture, and the saga flags holds older than two hours as stale.
- Remainder release. After a final capture a follow-up void answers 422 PREVIOUSLY_CAPTURED and the authorization reads CAPTURED, which we read as the remainder being released (inferred, not observed on a buyer balance). The saga treats that answer as released instead of an error.
- Redelivery and ordering. Webhooks can arrive twice or out of order, so handlers dedupe and the saga never trusts an event alone. Whether a PayPal retry keeps the original transmission id and time is not yet verified; we do not claim it.
- Real response shapes. Real events carry fields our simulator lacked (event_version, resource_type, summary, links and more), and the simulator emits fields PayPal does not. We committed six sanitized real fixtures and test against them.
- SDK v6 details. A client token request with domains[] answers 401 invalid_domain on localhost, and isEligible('basic_card') throws; guest card needs no eligibility key.

## What is next

- Record the G3 result and set the reauthorize behaviour from it.
- Run G5 on real-room and noisy recorded bids with real speech-to-text and calibrate the confirm thresholds.
- Record a live speech run through the `/audio` socket (gate G5), bring the latency targets within budget, and deploy a hosted demo with a persistent disk.
- Publish a recorded replay and the screenshots.
- Run a full many-bidder settlement, including a crash and resume, on the sandbox.

## Built with

OWNER: list the tools, models and PayPal APIs exactly as the Devpost form asks. PayPal APIs used in code: Orders v2 (intent AUTHORIZE), Payments v2 (authorize, capture, void, reauthorize), Webhooks verify-webhook-signature, JS SDK v6. Other stack: TypeScript, Node 22, React, Vite, Vitest, Playwright, GitHub Actions, Render.

## Reuse statement

OWNER: state what was built during the hackathon period and what, if anything, was reused from earlier work.

## Links

OWNER: repository https://github.com/harshbhx/gavel-auction, hosted demo URL, video URL, judge walkthrough.
