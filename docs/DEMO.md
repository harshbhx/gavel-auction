# Demo and judge test guide

How to run the hosted GAVEL demo and check that it does what it claims. Everything runs in the PayPal sandbox only. No real money moves and no real card or PayPal account is needed.

Status labels used below: "available" means the code is on main today. "not available yet" means the part is specified (see `docs/specs`) but not built or not deployed, so the step cannot be followed end to end yet.
`packages/server` has an entry point (`npm start -w @gavel/server`, `src/main.ts`) and HTTP routes under `src/http`, but no WebSocket gateway is mounted, so bidding over a socket is not possible in the booted process. The steps in sections 2, 3, 5 and 7 that need a live socket room describe the intended flow and cannot be followed end to end today. What runs today is the engine, the settlement code against the fake PayPal, and the web components, each in its own tests.

This guide is updated as those parts land.

## 1. What to open

| Item                          | Where                                                                                                                                  | Status                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hosted demo (web)             | URL to be published here and in the Devpost entry                                                                                      | not available yet (deployment issues QA-59 to QA-61 are open)                                                     |
| Landing page `/`              | Explains the promise: a bid is a PayPal hold, nothing is charged until the hammer. Buttons: "Start a demo auction", "Join with a code" | specified in SPEC-web; the app shell is a placeholder today, not available yet                                    |
| Demo launcher `/demo`         | Creates a room and gives four links: auctioneer console, big screen, bidder QR, audit trail                                            | not available yet                                                                                                 |
| Replay `/replay/:recordingId` | Plays a recorded auction, read only                                                                                                    | the player and bundle format exist in `packages/web/src/screens/replay`; hosting a recording is not available yet |

Every page shows a "Sandbox: no real money moves" banner. A room is labelled "Live sandbox room", "Scripted demo: recorded events, no PayPal calls" or "Recorded: this is a replay" so you always know which mode you are in.

## 2. Join as a bidder

1. Open the QR link from the launcher, or `/join/<roomId>` and type the six-character code.
2. Choose "Join as bidder" and pick a ceiling (the most you may bid). The page creates a PayPal order with intent AUTHORIZE for that ceiling.
3. Approve it as a buyer:
   - PayPal sandbox buyer: sign in with a sandbox personal account. Sandbox buyer accounts are created in the PayPal developer dashboard (issue PAY-58). Credentials are never stored in this repository. Organisers hand out a test buyer at the event; never use a real account.
   - Fake buyer: in a fake-payments room the page uses the built-in fake PayPal and approves after a short pause, with no sign-in. Faults (cancel, decline, slow, error) can be simulated to test the failure screens. A fake-payments room is the default until the sandbox proof is complete.
4. The ladder shows your hold moving to HELD. A hold is a promise, not a charge.

Card and guest AUTHORIZE works in our sandbox (gate G2 in `docs/GATES.md` is PASS, 2026-11-05): a wallet buyer and a guest with a sandbox card were both authorized through the JS SDK v6. Capture and void for card buyers are not tested yet.

### What judges can test on the hosted demo

The hosted server runs in production mode, which refuses fake payments (`packages/server/src/config.ts`). A judge therefore sees one of two things, labelled on every page:

1. Live sandbox room: needs a PayPal sandbox buyer. The sandbox buyer logins and wallet-only instructions are published in the Devpost entry and the repository's judge walkthrough, never in the source tree. Card and guest checkout may be offered: gate G2 passed (2026-11-05).
2. Recorded replay: `/replay/:recordingId` plays a labelled recorded auction with no PayPal calls. It is the fallback when no sandbox buyer is at hand and the only path that needs no login.

The scripted demo launcher uses fake payments, so it is not available on the hosted server. Run it locally to see the fake PayPal.

Timing. A hold older than 2 hours (`GAVEL_HOLD_MAX_AGE_MS`, 7,200,000 ms) when the settlement starts is flagged stale and a `stale_hold` row is written to the audit trail. A stale hold is still captured; the flag is a warning, not a refusal. PayPal's honor period for an authorization is unproven (gate G3), so register, bid and hammer within one sitting. A judge who registers and comes back later may see the hold flagged or voided by PayPal, in which case the bidder is dropped from the ladder as a revoked hold. Seeded demo data holds no real authorizations and is shown only as recorded events.

## 3. Bid: QR or typed entry

- QR: the big screen shows a QR code that opens `/join/<roomId>?c=<code>` on your phone. After joining, the bid screen at `/r/<roomId>/bid` has a quick-bid button, +increment buttons and a custom amount field. Bids above your ceiling are blocked.
- Typed entry: the auctioneer console at `/r/<roomId>/console` has "Manual entry" to place a bid for a registered bidder. It is recorded with source `manual`.
- Voice: the console microphone turns a spoken bid into a structured bid and asks for confirmation when the amount is ambiguous. Live voice needs speech provider keys on the server, so live voice is not available yet; use the replay below.

## 4. Replay mode for voice

Replay plays a recorded auction through the same console, big screen and ladder components, read only. It includes recorded audio with captions, speed control and chapters (Registrations, First bid, Confirmation, Hammer, Settlement). If the audio file cannot load, the captions still play. Use it to hear the noisy bids and see the confirm-on-ambiguity step without a microphone. The first recording (charity gala) is not available yet.

## 5. Expected result at the hammer

When the auctioneer hammers, check that:

1. The winner's hold is captured for the winning price only, not the ceiling. For example a $500 ceiling and a $350 winning bid captures $350.
2. Every other bidder's hold is voided. The winner's unused remainder is released: the settlement code reads the authorization after the capture and, if PayPal still shows an open remainder, voids it explicitly (`packages/payments/src/saga/remainder.ts`). This is tested against the fake PayPal in both modes (remainder auto-released or not). On the PayPal sandbox (gate G1, 2026-11-04) the remainder was released automatically after the final capture for a wallet buyer; an explicit void afterwards answers 422 `PREVIOUSLY_CAPTURED` and counts as released. Card buyers are untested.
3. The ladder shows HELD, then CAPTURED for the winner and VOIDED for the others, with the source of each confirmation (PayPal webhook or lookup).
4. Exactly one capture happens even if the server stops mid-settlement and resumes. If PayPal's answer is unknown the settlement stops for review rather than guessing.

The settlement logic is built and tested against the fake PayPal only. Remainder release after a partial capture is proven on the PayPal sandbox for wallet buyers only. Gate G1 is PASS-WITH-FALLBACK (wallet only; guest/card G2 pending); card buyers are not tested. Webhook signature verification is proven on the PayPal sandbox (gate G4 PASS, 2026-11-05): six real events, including a capture and a void, each verified SUCCESS through PayPal's endpoint.

## 6. What is real and what is recorded

| Part                                     | Mode                                                                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auction rules, price, soft close, hammer | Real code, deterministic engine, same in every mode                                                                                                                                                                                                             |
| PayPal calls                             | Real sandbox only in a sandbox room and only once the gates pass (not available yet); remainder release after a final capture is proven on the sandbox for wallet buyers only, card buyers untested; otherwise the fake PayPal, shown as such in the room label |
| Scripted demo                            | Recorded events, no PayPal calls, labelled on screen                                                                                                                                                                                                            |
| Voice                                    | Replay uses recorded audio; live speech to text is not available yet                                                                                                                                                                                            |
| Speech accuracy numbers                  | Measured on a labelled test set (gate G5 is NOT RUN)                                                                                                                                                                                                            |

## 7. Audit trail

Open `/r/<roomId>/audit` from the launcher (it needs the auctioneer or reviewer link). The audit screen is specified to show accepted bids, rejected bids, confirmations and control actions with source, transcript and parsed amount, and to export CSV or JSON with a SHA-256 of the rows. The engine's hash-chained ledger records accepted bids (`BID_RECORDED`), each with its source (`manual`, `qr` or `voice`, as the client sent it) and an audit block that can hold the transcript, confidence and parser version. Rejected bids are not in the ledger: the server keeps them in the room log only (D-0014, D-0029), so `verify-ledger` cannot check them and the ledger export holds no `BID_REJECTED` entry. Until the voice adapter exists (section 8) no bid carries a transcript or confidence, so those fields are empty. Settlement writes a journal of each capture and void. A ledger export can be checked without a server: `verify-ledger <ledger.jsonl>` in `packages/engine` prints the entry count and head hash, or the first bad entry, and exits non-zero on tampering.

## 8. Not built yet

- Hosted deployment and the public demo URL (QA-59 to QA-61).
- The full web screens: the app shell is a placeholder on main today, so the console, bid screen, big screen and audit view exist as specs and tested components only.
- A WebSocket gateway mounted by the server entry point, so bidding works over a socket in the booted process.
- A persistent store for a hosted deploy (the file stores need a persistent disk and a single instance).
- An adapter from the voice package to the room.
- Real sandbox runs of gates G3 and G5 (NOT RUN in `docs/GATES.md`); G1 is PASS-WITH-FALLBACK (wallet only); G2 and G4 are PASS.
- Live voice with real speech providers.
- Recorded demo auctions for replay.
- Card and guest checkout in a live room (G2 PASS proves the SDK authorize flow; the room screens are not wired yet).
