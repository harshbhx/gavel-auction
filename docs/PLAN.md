# GAVEL v2: final plan (PayPal AI Hackathon 2026)

Deadline: Thu Nov 12 2026 12:00pm PST (= Fri Nov 13 01:30 IST). Early eligibility check if submitted by Nov 5 (optional). Team: Harsh + Dhairya (likely). Status: plan only; nothing built; nothing tested on real PayPal sandbox or real STT.

## 1. Pitch (one paragraph)

GAVEL turns every bid in a live auction into a PayPal payment promise. Bidders approve a PayPal authorization hold as their ceiling. Bids come in by voice, QR/mobile or manual entry; AI turns noisy spoken bids into structured, confirmable bids. A deterministic engine runs an ascending English auction. At the hammer GAVEL captures only the winning price from the winner's hold and voids every other hold, with a full audit trail. Start: small fundraisers and community auctions; engine works for any live auction.
Judge line: "Every charity auction has winners who never pay; GAVEL makes the bid itself a PayPal hold, so the hammer is a payment." (Do not quote a non-payment rate; none found.)

## 2. Changes from v1 (from red-team + outside evaluation)

1. English ascending (min increment, soft-close extension) is the main mode. Second-price/proxy ceiling is an optional mode, not the headline.
2. Hybrid input: voice + QR mobile bids + manual auctioneer entry. If speech fails, the demo still works.
3. Voice is a ~20 s feature in the video; the engine, PayPal state ladder and audit trail are the stars.
4. Bid audit trail per bid: audio timestamp, transcript, bidder, parsed amount, confidence, confirmed?, accepted/rejected + reason.
5. Ceiling presets (e.g. 100/250/500/1000, custom) with clear "held, not charged" copy.
6. Drop the shading/economics claim as a pitch point. Optional: one small LLM-bidder side chart, only if time remains (cite 2507.09083 and 2608.14613 only for what they actually show).
7. Pitch claims limited to: PayPal hold as hard ceiling + deterministic rules on spoken/hybrid bids + capture clearing price only + void rest. Never "first voice auction / first AI auctioneer / first PayPal holds" (neighbours: Criee, Every Rep, Rent-A-Bot, Voice Auction House, Showrunner).

## 3. Architecture

- Web app: React + TypeScript + Vite (bidder view, auctioneer console, public big-screen view, audit view).
- Real-time: Cloudflare Durable Object per auction + WebSockets (inferred feasible; test day 2). Fallback: single Node server with WebSockets on Render.
- Backend: Node + TypeScript API (PayPal secrets, webhooks) on Render.
- Payments: PayPal Orders v2 intent=AUTHORIZE; Payments v2 capture (partial, final_capture=true), void, reauthorize if needed; PayPal-Request-Id idempotency; webhooks (authorization voided, capture completed).
- Speech: Deepgram Nova-3 streaming (primary), Groq Whisper (fallback), browser Web Speech (try-it mode), plus recorded-audio "Replay auction" for judges.
- AI parse: structured-output LLM with deterministic validator; ambiguity -> "Did you mean 350 for paddle 12?" confirmation. LLM never decides winner or moves money.
- Store: Cloudflare D1 or Postgres (ledger + audit). Tests: Vitest + Playwright (run in GitHub Actions, not on the VM).
- Prototype already exists (scratch only, Python): engine, fake PayPal, saga, parser, 194 tests. Port the logic and tests to TypeScript; reuse the test cases and the parser's labelled utterances.

## 4. Settlement state machine (must be crash-safe)

register -> authorize (hold) -> active bidder -> bid parse -> confirm if low confidence -> deterministic validation (ceiling, increment, state) -> ledger -> hammer -> winner = highest valid bid -> capture winning amount (partial, final) -> void all other holds -> verify via webhook/GET -> final ledger. Fall back to runner-up if winner's hold expired/declined/voided (prototype tested). Invariants: at most one capture; captured <= ceiling; each non-winner voided exactly once; captured + released = holds; idempotent under retry/duplicate/out-of-order webhooks.

## 5. Gate tests (day 1, need PayPal sandbox app)

G1 authorize 500 -> capture 350 final_capture=true -> is the 150 remainder auto-released or still active? void it explicitly; check via GET and webhooks. Both PayPal-wallet and card sandbox buyers.
G2 guest/card AUTHORIZE flow in JS SDK v6 (Card Fields/Fastlane docs show CAPTURE sample; verify AUTHORIZE works). Fallback: PayPal-wallet sandbox buyers (bulk sandbox accounts).
G3 honor period vs validity conflict: docs differ (3-day vs 29-day; one page says 3-day validity in US with one reauthorization). Test reauthorize path; design the demo so all holds are created minutes before capture.
G4 webhooks: simulator events fail signature verification, so use real sandbox events.
G5 STT: 20 noisy bid utterances through Deepgram+LLM; target over 90% exact amount+bidder or rely on confirm-on-ambiguity.
If G1 or G2 fails with no workaround: switch to Orders AUTHORIZE with PayPal-wallet buyers only, or kill and pick Quake Commons.

## 6. Nine-day plan (today Nov 3; submit target Nov 11 evening PST, leave buffer)

- D1 (Nov 4): Sandbox app + gate tests G1-G4; repo + license (MIT) + CI skeleton. P1 PayPal, P2 audio/STT test G5.
- D2: Engine + ledger in TS (port prototype), WebSocket room; P2 mic capture + streaming STT.
- D3: PayPal saga (capture/void/idempotency/webhooks) + failure injection tests; P2 bidder registration + QR bid UI.
- D4: Auctioneer console + public screen; parse+confirm flow; audit trail view.
- D5: Integration end to end; Playwright E2E in Actions; crash/retry tests against sandbox.
- D6: Design polish, PayPal authorization-state ladder UI beside timeline; replay mode with recorded audio.
- D7: Hosted deploy (Render + Cloudflare), README, run instructions, judge walkthrough; load/race tests.
- D8: Record video (3:00 max), Devpost text, screenshots; freeze features.
- D9 (Nov 11-12): Final fixes, submit early (before Nov 12 noon PST = Nov 13 01:30 IST), YouTube public, repo public with license visible.
  Cut list if behind: LLM-bidder chart, NFC, second-price mode UI, AG Grid. Never cut: PayPal gate proof, audit trail, replay mode, tests, video.

## 7. Video storyboard (3:00)

0:00 problem (winner never paid; paper sheets) 0:20 register two bidders, holds visible in PayPal sandbox 0:45 live bidding: voice (20 s) + QR 1:15 confirm-on-ambiguity moment 1:40 hammer: winner captured at winning price, others voided, state ladder + webhook ticks 2:15 crash mid-settlement, resume, still exactly one charge 2:35 audit trail + test count 2:50 close. Mark what is real vs recorded on screen.

## 8. Submission checklist

Public repo + visible OSS license; run instructions + hosted URL (free to test until Dec 15); PayPal sandbox only; AI tool and model named in text; PayPal central; public YouTube <3 min, no copyrighted music; English; Devpost tools list; mention what changed if reused earlier work; optional early check by Nov 5.

## 9. Scoring targets (own estimate, not predictions)

Evaluators: simulated 54/75 (about 72%), outside AI 765/1000. Execution target 880+/1000. Top 3 about 3-8%, any prize about 10-20%.

## 10. Risks and what stays unknown

Weak video; rigor gap vs AP2-style entries; voice eating video; thin impact evidence (no non-payment data; interview 5-10 organizers if time); guest hold UX; PayPal sandbox quirks; legal items only matter for real product.

## 11. What I need from you

1. A PayPal developer sandbox app (Harsh or Dhairya, free) with credentials saved to a private file on the server (never in chat): I will tell you the exact path and variable names.
2. Confirm who is P1 (payments/backend) and P2 (frontend/audio/video), and whether Dhairya is in.
3. OK to create a private GitHub repo (name suggestion: gavel-auction) and MIT license.
4. Say "go". Until then I build nothing.
