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
| G4   | Webhook signature verification on real events | PASS                             |
| G5   | Speech-to-text accuracy on noisy bids         | NOT RUN                          |

Until the gates are run, behaviour against PayPal is established only against the project's own fake server. Bids are intended to arrive by voice, QR or typed entry; see the table for what exists today.

## Run it

Needs Node 22 and npm.

```
npm ci                      # install every workspace from the repo root
npm run build               # tsc -b
npm test                    # unit tests, every package
npm run test:property       # property tests; each prints its seed (GAVEL_PROPERTY_SEED replays it)
npm start -w @gavel/server  # start the server
npm run dev -w @gavel/web   # start the web dev server (separate process)
```

Copy `.env.example` to `.env` for the secret names the project reads: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `LLM_API_KEY`, `ADMIN_TOKEN`, `AUCTIONEER_TOKEN_SECRET`, `DATABASE_URL`. Never commit real values. The server reads its own settings from the process environment (`PORT`, `PUBLIC_URL`, `TOKEN_SECRET`, `ADMIN_KEY`, `STORE`, `PAYMENTS` and others); they are listed in `packages/server/README.md`.

The web app takes `VITE_SANDBOX=true` (sandbox banner and sandbox-only behaviour), plus `VITE_API_BASE`, `VITE_WS_BASE`, `VITE_PAYMENTS` and `VITE_PAYPAL_CLIENT_ID`.

Payment modes: with `PAYMENTS=fake` the server talks to the built-in fake PayPal and no network access is needed; with `PAYMENTS=sandbox` it calls the PayPal sandbox and needs the PayPal secrets. Production mode (`NODE_ENV=production`) refuses fake payments. Runbooks: `packages/server/README.md`, `packages/voice/README.md`. Contributing: `CONTRIBUTING.md`.

Plan and architecture: `docs/PLAN.md`. Demo and test guide: `docs/DEMO.md`. The Python files in `reference/python` are a reference implementation that the TypeScript packages are checked against.

License: MIT.
