# GAVEL: design plan (PayPal AI Hackathon 2026)

Deadline: Thu Nov 12 2026 12:00pm PST (= Fri Nov 13 01:30 IST). Early eligibility check if submitted by Nov 5 (optional). Scope: PayPal sandbox only. Behaviour against the real PayPal sandbox and real speech-to-text is not yet verified: the gate tests in section 5 have not been run (all NOT RUN in `docs/GATES.md`). Settlement is tested against the project's fake PayPal server only.

## 0. Current status

| Area                                                       | Works now                | Works with the fake PayPal only | Not built yet                                         |
| ---------------------------------------------------------- | ------------------------ | ------------------------------- | ----------------------------------------------------- |
| Engine and hash-chained ledger                             | yes                      |                                 | ledger verify command                                 |
| Settlement saga (capture, void, journal, resume, webhooks) |                          | yes                             | run against the real sandbox                          |
| Hold creation and approval service                         |                          | yes                             | HTTP routes for the web app                           |
| Room and runtime service with file stores                  | in tests, one process    |                                 | server entry point, HTTP and WebSocket routes, deploy |
| Web components, routes and replay player                   | components and tests     |                                 | working screens against a live room                   |
| Voice package (capture, STT clients, parser)               | offline                  |                                 | adapter into a room, live audio route                 |
| Replay of recorded audio                                   | player and bundle format |                                 | recording export, published recording                 |
| Crash and resume                                           | in-process test hook     |                                 | trigger on a hosted server                            |
| Hosted demo                                                |                          |                                 | Render deploy with a persistent disk                  |

Gate G1: PASS on the sandbox 2026-11-04 and 2026-11-05 (two PayPal-account buyers; guest card capture not covered). Gate G2: PASS on the sandbox 2026-11-05 (wallet and guest card AUTHORIZE). Gate G4: PASS. Gates G3 and G5: NOT RUN.

## 1. Pitch (one paragraph)

GAVEL turns every bid in a live auction into a PayPal payment promise. Bidders approve a PayPal authorization hold as their ceiling. Bids are designed to come in by voice, QR/mobile or manual entry (today the voice parser and the room exist as separate packages, with no adapter between them); AI turns noisy spoken bids into structured, confirmable bids. A deterministic engine runs an ascending English auction. At the hammer GAVEL captures only the winning price from the winner's hold and voids every other hold. This is tested against a fake PayPal server and not yet against the real sandbox. Start: small fundraisers and community auctions; engine works for any live auction.
Judge line: "Every charity auction has winners who never pay; GAVEL makes the bid itself a PayPal hold, so the hammer is a payment." (Do not quote a non-payment rate; none found.)

## 2. Design decisions

1. English ascending (minimum increment, soft-close extension) is the main mode. Second-price/proxy ceiling is an optional mode.
2. Hybrid input: voice, QR mobile bids and manual auctioneer entry, so the auction keeps working if speech fails.
3. Voice is one input path among several; the engine, the PayPal authorization-state ladder and the audit trail are the core of the product.
4. Bid audit trail per bid (target): audio timestamp, transcript, bidder, parsed amount, confidence, confirmed or not, accepted or rejected with reason. Today the hash-chained ledger records accepted bids with source `manual` and an empty audit object; rejected bids are kept in the room log only, which is not hash-chained.
5. Ceiling presets (for example 100/250/500/1000, or custom) with clear "held, not charged" copy.
6. No bidder-shading or economics claims are made. An optional LLM-bidder side chart may cite 2507.09083 and 2608.14613 only for what they show.
7. Claims are limited to: PayPal hold as a hard ceiling, deterministic rules on spoken and hybrid bids, capturing the clearing price only, and voiding the rest. No "first" claims (neighbouring projects: Criee, Every Rep, Rent-A-Bot, Voice Auction House, Showrunner).

## 3. Architecture

- Web app: React + TypeScript + Vite (bidder view, auctioneer console, public big-screen view, audit view).
- Real-time: a single Node process per host (decision D-0006), with the room and runtime in `packages/server`. There is no HTTP or WebSocket server entry point yet. A Cloudflare Durable Object per auction was considered and is not used.
- Backend: Node + TypeScript on Render (PayPal secrets, webhooks). The payments package and the runtime service exist; the API routes and the process that wires them together do not.
- Payments: PayPal Orders v2 intent=AUTHORIZE; Payments v2 capture (partial, final_capture=true), void, reauthorize if needed; PayPal-Request-Id idempotency; webhooks (authorization voided, capture completed).
- Speech: Deepgram Nova-3 streaming (primary), Groq Whisper (fallback), browser Web Speech (try-it mode), plus recorded-audio "Replay auction" for judges.
- AI parse: structured-output LLM with deterministic validator; ambiguity -> "Did you mean 350 for paddle 12?" confirmation. LLM never decides winner or moves money.
- Store: JSON and JSON-lines files on local disk (room log, ledger, journals, holds, webhook events). Each file belongs to one process; there is no cross-process lock. A hosted deploy needs a persistent disk and a single instance, or a move to a database; neither exists yet. Tests: Vitest + Playwright, run in GitHub Actions.
- Reference implementation (Python, `reference/python`): engine, fake PayPal, saga, parser and its tests. The TypeScript packages port its logic and reuse its test cases and labelled utterances.

## 4. Settlement state machine (must be crash-safe)

register -> authorize (hold) -> active bidder -> bid parse -> confirm if low confidence -> deterministic validation (ceiling, increment, state) -> ledger -> hammer -> winner = highest valid bid -> capture winning amount (partial, final) -> void all other holds -> verify via webhook/GET -> final ledger. Fall back to the runner-up if the winner's hold expired, was declined or was voided (covered by the reference implementation's tests). Invariants: at most one capture; captured <= ceiling; each non-winner voided exactly once; captured + released = holds; idempotent under retry/duplicate/out-of-order webhooks.

## 5. Gate tests (need a PayPal sandbox app; G1 PASS (PayPal-account buyers, guest capture not covered); G2 PASS; G4 PASS; the rest NOT RUN)

G1 authorize 500 -> capture 350 final_capture=true -> is the 150 remainder auto-released or still active? void it explicitly; check via GET and webhooks. Both PayPal-wallet and card sandbox buyers.
G2 guest/card AUTHORIZE flow in JS SDK v6 (Card Fields/Fastlane docs show CAPTURE sample; verify AUTHORIZE works). Fallback: PayPal-wallet sandbox buyers (bulk sandbox accounts).
G3 honor period vs validity conflict: docs differ (3-day vs 29-day; one page says 3-day validity in US with one reauthorization). Test reauthorize path; design the demo so all holds are created minutes before capture.
G4 webhooks: PASS 2026-11-05, six real sandbox events verified (docs/GATES.md); the simulator events are not accepted by PayPal, so tests use the fixtures.
G5 STT: 20 noisy bid utterances through Deepgram+LLM; target over 90% exact amount+bidder or rely on confirm-on-ambiguity.
If G1 or G2 fails with no workaround: switch to Orders AUTHORIZE with PayPal-wallet buyers only.

## 6. Video storyboard (3:00)

0:00 problem (winner never paid; paper sheets) 0:20 register two bidders, holds visible in PayPal sandbox 0:45 live bidding: voice (20 s) + QR 1:15 confirm-on-ambiguity moment 1:40 hammer: winner captured at winning price, others voided, state ladder + webhook ticks 2:15 crash mid-settlement, resume, still exactly one charge (planned: today only an in-process test hook exists, with no trigger on a hosted server) 2:35 audit trail + test count 2:50 close. Mark what is real vs recorded on screen.

## 7. Submission checklist

Public repo + visible OSS license; run instructions + hosted URL (not deployed yet; holds expire within days, so the hosted build needs fresh sandbox holds at test time); PayPal sandbox only; AI tool and model named in text; PayPal central; public YouTube <3 min, no copyrighted music; English; Devpost tools list; mention what changed if reused earlier work; optional early check by Nov 5.

## 8. Risks and what stays unknown

Weak video; rigor gap vs AP2-style entries; voice eating video; thin impact evidence (no non-payment data; interview 5-10 organizers if time); guest hold UX; PayPal sandbox quirks; legal items only matter for real product.
