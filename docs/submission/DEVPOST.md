# GAVEL: Devpost entry (paste-ready)

How to use this file: copy each block into the Devpost field named in its heading, in the order of the headings. Every claim is checked against [`docs/GATES.md`](../GATES.md) and the evidence under [`docs/evidence/`](../evidence); the README says the same things in the same words. Lines marked HAND need the submitter on Devpost (see [`DEVPOST-CHECKLIST.md`](DEVPOST-CHECKLIST.md)). PayPal sandbox only: no live charge is made anywhere in this project.

## Fields

| Devpost field              | Value                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project name               | GAVEL                                                                                                                                                         |
| Tagline (49 characters)    | Every bid is a PayPal hold. Only the winner pays.                                                                                                             |
| Elevator pitch (under 200) | A live auction where every bid is a PayPal hold. At the hammer GAVEL captures the winning price, voids the rest, and seals the result in a verifiable ledger. |
| Thumbnail                  | `docs/assets/devpost/01-hero-poster.png` (1200x800, 3:2)                                                                                                      |
| Code repository            | https://github.com/harshbhx/gavel-auction (public, MIT)                                                                                                       |
| Try it out links           | See "Try it out links" below                                                                                                                                  |
| Video demo link            | HAND: the YouTube link, after the video is recorded and uploaded                                                                                              |
| Built with                 | See "Built with" below (25 tags at most)                                                                                                                      |

## Project story

Paste from here to "What's next" into the story field. Devpost accepts Markdown.

### Inspiration

At a live auction or a fundraiser, bidders hesitate when a card is charged up front, so they bid less or not at all. The other way round, bids are unsecured: a winner can walk away after the hammer and the organizer chases payment afterwards. Paper sheets and shouted bids make the record hard to trust. PayPal already separates authorizing money from capturing it, and that is the shape of an auction: hold a ceiling, bid under it, capture only the winning price at the hammer.

### What it does

GAVEL makes each bid a PayPal AUTHORIZE hold.

- **Hold.** A bidder approves a ceiling, the most they may bid, as an authorization hold. It is held, not charged.
- **Bid.** A deterministic engine runs an ascending English auction with a minimum increment and a soft close. A bid above a bidder's ceiling is refused. Bids come from phones, a QR code, the console or, with a confirm step, by voice.
- **Hammer.** The auctioneer holds a button to close the lot. GAVEL captures only the winning price from the winner's hold and voids every other hold. Until the capture, money is held, not charged.
- **Receipt and verify.** Every accepted bid goes into a hash-chained ledger. Anyone can replay the public export and check the chain; an edited entry is marked as edited.
- **Voice bids.** A spoken bid is turned into a structured bid by a parser with a deterministic validator. Every spoken bid goes through a confirm prompt ("Did you mean 350 for paddle 12?"). The parser never decides a winner and never moves money.

A judge can run the whole thing without an account: open the [judge panel](https://gavel.dualmindlab.tech/try), start a demo room, join as a bidder from the hub, bid, hammer, and read the receipt.

### How we built it

A TypeScript monorepo (npm workspaces, Node 22) with a Python reference implementation used for differential tests of the engine and the parser.

- `packages/engine`: auction rules, commands and events, the hash-chained ledger and replay, with no Node built-ins so the same events always give the same result.
- `packages/payments`: PayPal Orders v2 (intent AUTHORIZE) and Payments v2 (authorize, capture, void, reauthorize), JS SDK v6, signature-verified webhooks, the hold service, the settlement saga and a built-in fake PayPal for offline tests.
- `packages/server`: one Node host with HTTP routes, a room WebSocket gateway and file stores.
- `packages/voice`: audio capture, Deepgram and Groq speech-to-text with failover, and the bid parser.
- `packages/web`: bidder phone, auctioneer console, big screen, receipt, audit and replay screens, in React and Vite.
- `packages/shared` and `packages/e2e`: money in integer cents, wire types, and the scenario DSL and sandbox specs.

The settlement saga is journaled. If the process dies mid-settlement, it checks the truth at PayPal, then continues the capture and the voids instead of repeating them. If PayPal's answer is unknown, settlement stops for review rather than guessing.

Where the partners fit:

- **PayPal:** all payments run on the sandbox: Orders v2, Payments v2, webhook signature verification and JS SDK v6.
- **Cloudflare:** the web app runs as a Worker with static assets, and the docs site is deployed to Cloudflare, both on custom domains with security headers.
- **Render:** the API and WebSocket host is one Node web service on the `starter` plan, always on, with a 1 GB persistent disk for the ledger, room log, settlement journals and hold records.
- **AG Grid:** the audit ledger, the console bid history and the holds table are AG Grid Community tables, with sorting, filters, CSV export and an in-browser chain check.
- **APIMatic:** the OpenAPI 3.1 spec of the host API is linted in CI and checked against the server router; SDK and portal generation from it is in progress.
- **Hugging Face:** five small datasets and a read-only Evidence Explorer Space, each labelled real sandbox, simulated or synthetic.

### Challenges we ran into

- **Sandbox account region.** The sandbox accounts must be US accounts. PayPal rejects INR orders for sandbox buyers with 422 CURRENCY_NOT_SUPPORTED, so every gate sends USD.
- **Authorization validity.** PayPal documents an honor period and a validity window that disagree across pages (3 days versus 29 days, with one reauthorization). A real probe has been running since 7 Nov 2026 03:06 UTC (gate G3, final reading about 12 Nov 06:17 UTC); the 29-day figure is not yet verified in the real sandbox. Until it reports, the demo creates holds minutes before the capture and the saga flags holds older than two hours as stale.
- **Remainder release.** After a final capture a follow-up void answers 422 PREVIOUSLY_CAPTURED and the authorization reads CAPTURED, which we read as the remainder being released. That is inferred, not read from a buyer balance, and the saga treats the answer as released instead of an error.
- **Webhooks arrive twice or out of order.** Handlers de-duplicate and the saga never trusts an event alone. Real events carry fields our simulator lacked, so we committed six sanitized real fixtures and test against them.
- **SDK v6 details.** A client token request with `domains[]` answers 401 `invalid_domain` on localhost, and `isEligible('basic_card')` throws; guest card needs no eligibility key.
- **Speed.** On the sandbox, hammer to settled for 6 holds has p95 6927.43 ms against a 6000 ms target and hammer to captured p95 3766.67 ms against 2500 ms (49 of 50 completed, run INCOMPLETE). Both targets are missed, and PayPal call latency is most of it. The decision to keep, raise or reduce is open.
- **Voice in noise.** A held-out noisy set of 120 synthetic clips, measured once against thresholds fixed beforehand, read wrong accept 0.058 for Groq and 0.092 for Deepgram against 0.05. That is why every spoken bid stays behind a confirm prompt.

### Accomplishments that we are proud of

- Gates G0, G1, G2 and G4 PASS on the real PayPal sandbox: app and buyers, partial capture with `final_capture`, wallet and guest card holds, and six real webhooks verified ([`docs/GATES.md`](../GATES.md)).
- A real server process was killed once after the capture request and before the response. After restart on the same data folder it settled with one capture of 12500 equal to the hammer price, two losers voided, a journal equal to PayPal and a ledger of 19 entries that verifies (run 42558021614, [`docs/evidence/server-kill`](../evidence/server-kill)).
- Live speech through the `/audio` socket: both providers answered 24 of 24 synthetic clips, and no spoken bid was accepted without a confirm (run 42575018866).
- The hosted judge flow passed all 17 steps on the live domains, from the judge panel through join, bids, hammer and receipts (judge smoke run 42584326641).
- The hosted webhook route answered at p95 112.03 ms against a 300 ms target (n=50, runner network included), and warmup after 16 minutes idle took at most 0.66 s (n=2).
- Per-judge API keys: with a key, a judge can open a sandbox room, bid, hammer and read the ledger over HTTP, with a Try it panel in the docs.
- More than 4,500 test cases run in CI, and all eight P0 items of the security review PASS.
- The evidence is open: five datasets with sha256 manifests, each labelled for what it is.

### What we learned

- A hold is a better auction primitive than a charge: the ceiling is real money, so a refused bid is a fact, not a guess.
- Do not trust one source of truth during settlement. Ask PayPal what happened before acting, journal every step, and treat an unknown answer as a stop, not a retry.
- Real services differ from their simulators in small ways, and the fixtures from real runs found those differences faster than reading documentation did.
- Label every number with what it measured. We kept the real sandbox, simulated and synthetic results apart, and kept the misses on the page.

### What's next

- Record the G3 result and set the reauthorize behaviour from it.
- Run G5 with a person in a real room and in recorded noise, and add an audio sender to the console.
- Decide the latency targets: keep, raise with a reason, or reduce latency.
- Drive a whole auction through the deployed server and repeat the process kill and resume there; one kill has run on a CI runner.
- Host recorded auctions for replay, and finish SDK and portal generation from the OpenAPI spec.

Full list with owners: [`docs/LIMITATIONS.md`](../LIMITATIONS.md).

## What is real versus simulated

Paste under the story if the form allows a table; otherwise as a list.

| Part                          | Real                                                                                                                                                      | Simulated or recorded                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Authorize, capture, remainder | Authorization reads CAPTURED after a 350 of 500 final capture on the sandbox for two PayPal-account buyers (G1); the release of the remainder is inferred | Saga tests against the project's fake PayPal                                                                |
| Card and guest holds          | Wallet and guest card AUTHORIZE in SDK v6 on the sandbox (G2)                                                                                             | n/a                                                                                                         |
| Webhooks                      | Six real sandbox events verified through PayPal's endpoint (G4)                                                                                           | Tampered-event rejection and the retry schedule are tested against the fake only                            |
| Honor period                  | A real probe is running (G3, final reading about 12 Nov 06:17 UTC)                                                                                        | 30 days of auctions on a fake clock ([SIM-MULTIDAY](../evidence/SIM/SIM-MULTIDAY.md)); not a sandbox result |
| Settlement and crash          | 20 and 49 settlements of 6 holds measured on the sandbox; in-process crash resume in the nightly runs; one real process kill on a CI runner               | Many crash points and kills run against the fake PayPal; the kill was not on the deployed host              |
| Speech                        | Live socket run with real providers on synthetic clips (24 of 24 answered)                                                                                | All audio is synthetic; the text parser is measured on 169 transcripts; no real room yet (G5 PARTIAL)       |
| Hosted demo                   | Web at gavel.dualmindlab.tech and API at api.gavel.dualmindlab.tech, sandbox mode, one Render service with a 1 GB disk                                    | Demo holds can be simulated, and `/demo/scripted` is a recorded room in the browser                         |
| Money                         | No real money moves anywhere; all PayPal calls are sandbox                                                                                                |                                                                                                             |

## Built with

Tags to add on the form (25 at most): `typescript`, `node.js`, `react`, `vite`, `paypal`, `paypal-orders-api`, `paypal-payments-api`, `paypal-js-sdk`, `cloudflare-workers`, `cloudflare-pages`, `render`, `ag-grid`, `hugging-face`, `deepgram`, `groq`, `websockets`, `openapi`, `vitest`, `playwright`, `github-actions`, `python`, `next.js`, `fumadocs`.

PayPal APIs used in code: Orders v2 (intent AUTHORIZE), Payments v2 (authorize, capture, void, reauthorize), webhook signature verification (`verify-webhook-signature`) and JS SDK v6.

HAND: if the form asks for models, list the speech-to-text models, Deepgram nova-3 and Groq whisper-large-v3-turbo. The voice package also has an optional language-model second reading configured by `LLM_API_KEY` (see `packages/voice/README.md`); check whether the hosted API sets it before stating one way or the other.

## Try it out links

- Judge panel (live sandbox room, no login): https://gavel.dualmindlab.tech/try
- Scripted demo (about 1 minute, recorded, no server): https://gavel.dualmindlab.tech/demo/scripted
- Demo room (about 3 minutes): https://gavel.dualmindlab.tech/demo
- Docs: https://docs.gavel.dualmindlab.tech
- API reference: https://docs.gavel.dualmindlab.tech/api-reference
- Call the API as a judge: https://docs.gavel.dualmindlab.tech/docs/judges/call-the-api
- Trust and FAQ: https://docs.gavel.dualmindlab.tech/docs/judges/trust-and-faq
- Hugging Face collection: https://huggingface.co/collections/harshbhx/gavel-evidence-auction-holds-hammer-and-receipts-6af0afebebb37eb4c9184504
- Evidence Explorer Space: https://huggingface.co/spaces/harshbhx/gavel-evidence-explorer
- Source: https://github.com/harshbhx/gavel-auction

## Testing instructions

Paste [`docs/judges/DEVPOST-TESTING.md`](../judges/DEVPOST-TESTING.md) into the testing field. HAND: add the two sandbox buyer logins there on Devpost only; never commit them.

## Image gallery and thumbnail

Upload order, alt text and captions are in [`DEVPOST-IMAGES.md`](DEVPOST-IMAGES.md). HAND: upload them on Devpost in that order.

## Reuse statement

HAND: confirm before pasting. Draft from the repository history: all code in this repository was written during the hackathon period, from the initial commit on 4 Nov 2026 (599 commits on main by 9 Nov). It uses open-source libraries and the third-party services listed under Built with. The brand marks and graphics were made for this project.

## Hackathon form extras

HAND: open the live Devpost form and fill what it adds beyond the generic fields (category, developer account ID, tool feedback, "how you improved the project"). The checklist lists them.
