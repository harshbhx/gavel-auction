# GAVEL

GAVEL is a live auction in which each bid is meant to be backed by a PayPal authorization hold. Bidders approve a ceiling up front, a deterministic engine runs the auction, and at the hammer only the winning price is captured while the other holds are voided.

Status: in development for the PayPal AI Hackathon 2026 (PayPal sandbox only). The pieces below are built as separate packages and tested against a fake PayPal server. They are not yet wired into a running, hosted application, and only part of the payment behaviour has been run against the real PayPal sandbox: the wallet remainder release (G1) and webhook signature verification (G4) were observed there; card and guest funding (G2), honor period (G3) and speech accuracy (G5) were not.

| Area                                                                                                      | Works now                | Works with the fake PayPal only | Not built yet                                         |
| --------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------- | ----------------------------------------------------- |
| Auction engine (English ascending, soft close, hash-chained ledger)                                       | yes                      |                                 |                                                       |
| Settlement (capture the winning price, void other holds, journal, resume after a crash, webhook handling) |                          | yes                             | run against the real sandbox                          |
| Hold creation and approval service                                                                        |                          | yes                             | HTTP routes that expose it to the web app             |
| Room and runtime service (bid intake, settlement scheduling, file stores)                                 | in tests, in one process |                                 | WebSocket gateway, deploy                             |
| Web app (routes, bid and console components, replay player)                                               | components and tests     |                                 | working screens against a live room, hosted URL       |
| Voice (audio capture, Groq speech-to-text client, bid parser)                                             | as a package, offline    |                                 | adapter that feeds bids into a room, live audio route |
| Bid input by QR or typed entry                                                                            | components only          |                                 | end-to-end flow on a server                           |
| Replay of a recorded auction                                                                              | player and bundle format |                                 | exporting a recording, a published recording          |

PayPal sandbox gates (see `docs/GATES.md`):

| Gate | Question                                      | Status                                              |
| ---- | --------------------------------------------- | --------------------------------------------------- |
| G1   | Partial capture and release of the remainder  | PASS (wallet and card)                              |
| G2   | Card and guest AUTHORIZE                      | PASS (wallet and guest card authorized, 2026-11-05) |
| G3   | Honor period, validity and reauthorize        | NOT RUN                                             |
| G4   | Webhook signature verification on real events | PASS                                                |
| G5   | Speech-to-text accuracy on noisy bids         | NOT RUN                                             |

Voice not wired yet: the Deepgram, Web Speech and replay speech-to-text clients and failover between providers are built but not selectable (so only Groq runs, in chunks). With both `DEEPGRAM_API_KEY` and `GROQ_API_KEY` set, provider selection skips Deepgram, uses Groq and logs a warning.

Apart from G1 (wallet remainder release) and G4 (webhook verification), behaviour against PayPal is established only against the project's own fake server. Bids are intended to arrive by voice, QR or typed entry; see the table for what exists today.

## Run it

Needs Node 22 and npm.

```
npm ci                      # install every workspace from the repo root
npm run build               # tsc -b
npm test                    # unit tests, every package
npm run test:property       # property tests; each run prints its seed; GAVEL_PROPERTY_SEED=<n> replays it (FC_SEED also works in e2e)
npm start -w @gavel/server  # start the server
npm run dev -w @gavel/web   # start the web dev server (separate process)
```

Copy `.env.example` to `.env` for the secret names the project reads: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `LLM_API_KEY`, `DATABASE_URL`. Never commit real values. The server reads its own settings from the process environment (`PORT`, `PUBLIC_URL`, `TOKEN_SECRET`, `ADMIN_KEY`, `STORE`, `PAYMENTS` and others); they are listed in `packages/server/README.md`.

The web app takes `VITE_SANDBOX=true` (sandbox banner and sandbox-only behaviour), plus `VITE_API_BASE`, `VITE_WS_BASE`, `VITE_PAYMENTS` and `VITE_PAYPAL_CLIENT_ID`.

Payment modes: with `PAYMENTS=fake` the server talks to the built-in fake PayPal and no network access is needed; with `PAYMENTS=sandbox` it calls the PayPal sandbox and needs the PayPal secrets. Production mode (`NODE_ENV=production`) refuses fake payments. Runbooks: `packages/server/README.md`, `packages/voice/README.md`. Contributing: `CONTRIBUTING.md`.

Plan and architecture: `docs/PLAN.md`. Demo and test guide: `docs/DEMO.md`. Of the Python files in `reference/python`, only `engine.py` (golden fixtures and differential test) and `parser.py` (parser golden test) are compared with the TypeScript packages; `saga.py` and `fake_paypal.py` are not run against the TypeScript saga or fake.

License: MIT.
