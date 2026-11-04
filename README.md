# GAVEL

GAVEL is a live auction in which each bid is meant to be backed by a PayPal authorization hold. Bidders approve a ceiling up front, a deterministic engine runs the auction, and at the hammer only the winning price is captured while the other holds are voided.

Status: in development for the PayPal AI Hackathon 2026 (PayPal sandbox only). The pieces below are built as separate packages and tested against a fake PayPal server. They are not yet wired into a running, hosted application, and nothing has been run against the real PayPal sandbox.

| Area                                                                                                      | Works now                | Works with the fake PayPal only | Not built yet                                         |
| --------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------- | ----------------------------------------------------- |
| Auction engine (English ascending, soft close, hash-chained ledger)                                       | yes                      |                                 |                                                       |
| Settlement (capture the winning price, void other holds, journal, resume after a crash, webhook handling) |                          | yes                             | run against the real sandbox                          |
| Hold creation and approval service                                                                        |                          | yes                             | HTTP routes that expose it to the web app             |
| Room and runtime service (bid intake, settlement scheduling, file stores)                                 | in tests, in one process |                                 | server entry point, HTTP and WebSocket routes, deploy |
| Web app (routes, bid and console components, replay player)                                               | components and tests     |                                 | working screens against a live room, hosted URL       |
| Voice (audio capture, speech-to-text clients, bid parser)                                                 | as a package, offline    |                                 | adapter that feeds bids into a room, live audio route |
| Bid input by QR or typed entry                                                                            | components only          |                                 | end-to-end flow on a server                           |
| Replay of a recorded auction                                                                              | player and bundle format |                                 | exporting a recording, a published recording          |

PayPal sandbox gates (see `docs/GATES.md`):

| Gate | Question                                      | Status                           |
| ---- | --------------------------------------------- | -------------------------------- |
| G1   | Partial capture and release of the remainder  | PASS-WITH-FALLBACK (wallet only) |
| G2   | Card and guest AUTHORIZE                      | NOT RUN                          |
| G3   | Honor period, validity and reauthorize        | NOT RUN                          |
| G4   | Webhook signature verification on real events | NOT RUN                          |
| G5   | Speech-to-text accuracy on noisy bids         | NOT RUN                          |

Until the gates are run, behaviour against PayPal is established only against the project's own fake server. Bids are intended to arrive by voice, QR or typed entry; see the table for what exists today.

Plan and architecture: `docs/PLAN.md`. Demo and test guide: `docs/DEMO.md`. The Python files in `reference/python` are a reference implementation that the TypeScript packages are checked against.

License: MIT.
