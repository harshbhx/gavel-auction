# @gavel/server

The single-process host: HTTP routes, room runtime, settlement scheduling and file stores. No WebSocket gateway is mounted by `src/main.ts` yet, so bidding over a socket is not possible in the booted process. Sandbox only; no real money moves.

## Run

From the repo root:

```
npm ci
PUBLIC_URL=http://localhost:8080 TOKEN_SECRET=dev-token-secret ADMIN_KEY=dev-admin-key \
  npm start -w @gavel/server
```

The process validates its environment first and exits with every problem listed if a value is missing or invalid. On success it prints one JSON line, `{"msg":"listening","port":...}`. `SIGTERM` and `SIGINT` stop accepting connections and exit.

Health: `GET /healthz` (process is up), `GET /readyz` (stores and payments are ready), `GET /metrics` (JSON snapshot).

## Configure

Settings come from the process environment (`src/config.ts`).

| Name                                                            | Default       | Notes                                                                                   |
| --------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `PORT`                                                          | 8080          | 1 to 65535                                                                              |
| `PUBLIC_URL`                                                    | required      | absolute URL used in links                                                              |
| `NODE_ENV`                                                      | development   | `development`, `test`, `production`                                                     |
| `TOKEN_SECRET`                                                  | required      | signs auctioneer and bidder tokens; 32 bytes or more in production                      |
| `TOKEN_SECRET_PREVIOUS`, `TOKEN_SECRET_PREVIOUS_UNTIL`          | unset         | previous secret accepted until the epoch-ms deadline (rotation)                         |
| `ADMIN_KEY`                                                     | required      | admin access; 24 characters or more in production                                       |
| `STORE`                                                         | memory        | `memory`, `file`, `postgres`, `d1`; `memory` needs `ALLOW_MEMORY_STORE=1` in production |
| `DATA_DIR`                                                      | ./data        | used when `STORE=file`                                                                  |
| `DATABASE_URL`                                                  | unset         | required when `STORE=postgres`                                                          |
| `PAYMENTS`                                                      | fake          | `fake` or `sandbox`; `fake` is refused in production                                    |
| `DEMO_MODE`                                                     | 0             | `1` enables the demo reset and seed endpoints; refused in production                    |
| `CORS_ORIGINS`                                                  | empty         | comma separated origins                                                                 |
| `LOG_LEVEL`                                                     | info          | `debug`, `info`, `warn`, `error`                                                        |
| `RATE_*`, `MAX_CONN_PER_*`, `MAX_ROOMS`, `MAX_BIDS_PER_AUCTION` | see config.ts | per-client rate limits and room limits                                                  |

With `PAYMENTS=sandbox` the payments layer also reads `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID` (names as in `.env.example`). Keep their values out of the repository, logs and the web bundle.

## Rotate secrets

1. Set `TOKEN_SECRET_PREVIOUS` to the current `TOKEN_SECRET` and `TOKEN_SECRET_PREVIOUS_UNTIL` to a deadline (epoch ms) after which old tokens stop working.
2. Set `TOKEN_SECRET` to the new value and restart. Tokens signed with either secret are accepted until the deadline.
3. After the deadline remove the two `PREVIOUS` settings and restart.
4. Rotate `ADMIN_KEY` by changing it and restarting; rotate PayPal credentials in the PayPal developer dashboard first, then update the environment.
5. A leaked auctioneer link is revoked with the auctioneer rotate endpoint, which issues a new link and raises a per-auction floor so every earlier auctioneer token stops working on HTTP and on socket join (live sockets are not closed). Rotate, `auctioneer/revoke-all` and `auctioneer/revoke` need the admin key.

## Demo reset

Only when `DEMO_MODE=1` (never in production): `POST /api/demo/reset` clears demo rooms and `POST /api/demo/seed` creates the scripted demo room. Both need the admin key.

## Troubleshooting

| Symptom                                       | Check                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Exits at start with a list of problems        | Each line names the setting; production adds length, store, payments and demo rules above   |
| `fake payments are not allowed in production` | Set `PAYMENTS=sandbox` and the PayPal secrets, or run with `NODE_ENV=development`           |
| `/readyz` fails                               | Store path or database unreachable, or PayPal credentials rejected; read the JSON log lines |
| Data gone after restart                       | `STORE=memory` keeps nothing; use `STORE=file` with `DATA_DIR` on a persistent disk         |
| Settlement stopped for review                 | PayPal's answer was unknown; the journal flags it instead of guessing. See `docs/DEMO.md` 5 |
| Webhooks rejected                             | `PAYPAL_WEBHOOK_ID` must match the sandbox webhook; signatures are verified                 |

## Shared fixtures

Contract fixtures and fake-PayPal scripts live in `packages/shared` and `packages/payments/src/fake`; the server tests and the end-to-end package reuse them.

## Tests

`npm test -w @gavel/server` and `npm run typecheck -w @gavel/server`; heavy runs happen in CI.
