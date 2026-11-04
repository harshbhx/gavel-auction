# Demo and judge test guide

How to run the hosted GAVEL demo and check that it does what it claims. Everything runs in the PayPal sandbox only. No real money moves and no real card or PayPal account is needed.

Status labels used below: "available" means the code is on main today. "not available yet" means the part is specified (see `docs/specs`) but not built or not deployed, so the step cannot be followed end to end yet.
`packages/server` has no entry point or HTTP routes yet, so the steps in sections 2, 3, 5 and 7 describe the intended flow and cannot be followed end to end today. What runs today is the engine, the settlement code against the fake PayPal, and the web components, each in its own tests.

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

Card and guest checkout is untested in our sandbox (gate G2 in `docs/GATES.md` is NOT RUN). If it fails, only PayPal wallet sandbox buyers will be offered.

## 3. Bid: QR or typed entry

- QR: the big screen shows a QR code that opens `/join/<roomId>?c=<code>` on your phone. After joining, the bid screen at `/r/<roomId>/bid` has a quick-bid button, +increment buttons and a custom amount field. Bids above your ceiling are blocked.
- Typed entry: the auctioneer console at `/r/<roomId>/console` has "Manual entry" to place a bid for a registered bidder. It is recorded with source `manual`.
- Voice: the console microphone turns a spoken bid into a structured bid and asks for confirmation when the amount is ambiguous. Live voice needs speech provider keys on the server, so live voice is not available yet; use the replay below.

## 4. Replay mode for voice

Replay plays a recorded auction through the same console, big screen and ladder components, read only. It includes recorded audio with captions, speed control and chapters (Registrations, First bid, Confirmation, Hammer, Settlement). If the audio file cannot load, the captions still play. Use it to hear the noisy bids and see the confirm-on-ambiguity step without a microphone. The first recording (charity gala) is not available yet.

## 5. Expected result at the hammer

When the auctioneer hammers, check that:

1. The winner's hold is captured for the winning price only, not the ceiling. For example a $500 ceiling and a $350 winning bid captures $350.
2. Every other bidder's hold is voided. The winner's unused remainder is released: the settlement code reads the authorization after the capture and, if PayPal still shows an open remainder, voids it explicitly (`packages/payments/src/saga/remainder.ts`). This is tested against the fake PayPal in both modes (remainder auto-released or not); gate G1 has not been run, so PayPal's real behaviour is unproven.
3. The ladder shows HELD, then CAPTURED for the winner and VOIDED for the others, with the source of each confirmation (PayPal webhook or lookup).
4. Exactly one capture happens even if the server stops mid-settlement and resumes. If PayPal's answer is unknown the settlement stops for review rather than guessing.

The settlement logic is built and tested against the fake PayPal only. Whether PayPal sandbox releases the remainder after a partial capture is not yet proven (gate G1 is NOT RUN). Webhook signature checks against real sandbox events (G4) are also not yet proven.

## 6. What is real and what is recorded

| Part                                     | Mode                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auction rules, price, soft close, hammer | Real code, deterministic engine, same in every mode                                                                                              |
| PayPal calls                             | Real sandbox only in a sandbox room and only once the gates pass (not available yet); otherwise the fake PayPal, shown as such in the room label |
| Scripted demo                            | Recorded events, no PayPal calls, labelled on screen                                                                                             |
| Voice                                    | Replay uses recorded audio; live speech to text is not available yet                                                                             |
| Speech accuracy numbers                  | Measured on a labelled test set (gate G5 is NOT RUN)                                                                                             |

## 7. Audit trail

Open `/r/<roomId>/audit` from the launcher (it needs the auctioneer or reviewer link). The audit screen is specified to show accepted bids, rejected bids, confirmations and control actions with source, transcript and parsed amount, and to export CSV or JSON with a SHA-256 of the rows. The engine's hash-chained ledger records both accepted bids (`BID_ACCEPTED`) and rejected bids (`BID_REJECTED`, with the reason), each with its source and an audit block that can hold the transcript, confidence and parser version. Until the voice adapter exists (section 8) every bid arrives as `manual`, so those fields are empty. Settlement writes a journal of each capture and void. A ledger export can be checked without a server: `verify-ledger <ledger.jsonl>` in `packages/engine` prints the entry count and head hash, or the first bad entry, and exits non-zero on tampering.

## 8. Not built yet

- Hosted deployment and the public demo URL (QA-59 to QA-61).
- The full web screens: the app shell is a placeholder on main today, so the console, bid screen, big screen and audit view exist as specs and tested components only.
- A server entry point with HTTP and WebSocket routes, including the hold routes the web app calls.
- A persistent store for a hosted deploy (the file stores need a persistent disk and a single instance).
- An adapter from the voice package to the room.
- Real sandbox runs of gates G1 to G5 (all NOT RUN in `docs/GATES.md`).
- Live voice with real speech providers.
- Recorded demo auctions for replay.
- Card and guest checkout (depends on G2).
