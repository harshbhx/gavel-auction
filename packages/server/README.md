# @gavel/server

The single-process host: HTTP routes, room runtime, settlement scheduling and file stores. `src/main.ts` boots `composeServer` (`src/boot/compose.ts`), which mounts the WebSocket gateway for live bidding and the `/audio` voice socket next to the HTTP routes. Sandbox only; no real money moves.

## Run

From the repo root:

```
npm ci
PUBLIC_URL=http://localhost:8080 TOKEN_SECRET="$(openssl rand -hex 16)" ADMIN_KEY="$(openssl rand -hex 12)" \
  PAYMENTS=fake PAYPAL_ENV=sandbox npm start -w @gavel/server
```

Production runs `npm run build -w @gavel/server` (esbuild bundle to `dist/main.js`) then `npm run start:prod -w @gavel/server`. The process validates its environment first (exit 78 naming each missing or invalid variable) and exits with every problem listed if a value is missing or invalid. On success it prints one JSON line, `{"msg":"listening","port":...}`. `SIGTERM` and `SIGINT` stop accepting connections and exit.

Health: `GET /healthz` (process is up), `GET /readyz` (the room store answers a ping; payments are not probed), `GET /metrics` (JSON snapshot).

The booted process serves the ops, webhook and admin routes (`/admin/export?auction=<id>`, `/admin/replay-bundle`, `/warmup`, `/metrics`, `/ops/*`, `/webhooks/paypal`). The auction, invite, join, control, read and token routes under `/api/` are mounted by `composeServer`, so `main.ts` serves them (create needs `x-admin-key`); the scripted `/api/demo/*` routes are mounted only with `DEMO_MODE=1` and `PAYMENTS=fake` (config refuses that combination under production-like settings), and the judge room routes (`/api/judge/*`) are mounted by `composeServer` too. Every route but `/healthz`, `/readyz` and the webhook is limited per client by `RATE_HTTP_*`; set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the host (1 on Render) so the client address is read from `x-forwarded-for`.

## Configure

Settings come from the process environment (`src/config.ts`).

| Name                                                            | Default       | Notes                                                                                   |
| --------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `PORT`                                                          | 8080          | 1 to 65535                                                                              |
| `PUBLIC_URL`                                                    | required      | absolute URL used in links                                                              |
| `NODE_ENV`                                                      | development   | `development`, `test`, `production`                                                     |
| `TOKEN_SECRET`                                                  | required      | signs auctioneer and bidder tokens; 32 bytes or more (waived when `NODE_ENV=test`)      |
| `TOKEN_SECRET_PREVIOUS`, `TOKEN_SECRET_PREVIOUS_UNTIL`          | unset         | previous secret accepted until the epoch-ms deadline (rotation)                         |
| `ADMIN_KEY`                                                     | required      | admin access; 24 characters or more (waived when `NODE_ENV=test`)                       |
| `STORE`                                                         | memory        | `memory`, `file`, `postgres`, `d1`; `memory` needs `ALLOW_MEMORY_STORE=1` in production |
| `DATA_DIR`                                                      | ./data        | used when `STORE=file`                                                                  |
| `DATABASE_URL`                                                  | unset         | required when `STORE=postgres`                                                          |
| `PAYMENTS`                                                      | fake          | `fake` or `sandbox`; `fake` is refused in production                                    |
| `DEMO_MODE`                                                     | 0             | `1` enables the demo reset and seed endpoints; refused in production                    |
| `DEMO_MAX_ROOMS`                                                | 20            | most live demo rooms `POST /api/demo/rooms` keeps; further creates return 429           |
| `CORS_ORIGINS`                                                  | empty         | comma separated origins                                                                 |
| `LOG_LEVEL`                                                     | info          | `debug`, `info`, `warn`, `error`                                                        |
| `RATE_*`, `MAX_CONN_PER_*`, `MAX_ROOMS`, `MAX_BIDS_PER_AUCTION` | see config.ts | per-client rate limits and room limits                                                  |

With `PAYMENTS=sandbox` the payments layer also reads `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID` (names as in `.env.example`). Keep their values out of the repository, logs and the web bundle.

## Rotate secrets

1. Set `TOKEN_SECRET_PREVIOUS` to the current `TOKEN_SECRET` and `TOKEN_SECRET_PREVIOUS_UNTIL` to a deadline (epoch ms) after which old tokens stop working.
2. Set `TOKEN_SECRET` to the new value and restart. Tokens signed with either secret are accepted until the deadline.
3. After the deadline remove the two `PREVIOUS` settings and restart.
4. Rotate `ADMIN_KEY` by changing it and restarting; rotate PayPal credentials in the PayPal developer dashboard first, then update the environment.
5. A leaked auctioneer link is revoked with the auctioneer rotate endpoint, which issues a new link and raises a per-auction floor so every earlier auctioneer token stops working on HTTP and on socket join and closes every open socket of the revoked token with 4401; a socket also closes when its token expires, and the token is re-checked on every bid or confirm frame. Rotate, `auctioneer/revoke-all` and `auctioneer/revoke` need the admin key.

## Demo reset

Only when `DEMO_MODE=1` (never in production): `POST /api/demo/reset` clears demo rooms and `POST /api/demo/seed` creates the scripted demo room. Both need the admin key.

## Troubleshooting

| Symptom                                       | Check                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Exits at start with a list of problems        | Each line names the setting; production adds length, store, payments and demo rules above             |
| `fake payments are not allowed in production` | Set `PAYMENTS=sandbox` and the PayPal secrets, or run with `NODE_ENV=development`                     |
| `/readyz` fails                               | Store path or database unreachable; read the JSON log lines (PayPal credentials are not checked here) |
| Data gone after restart                       | `STORE=memory` keeps nothing; use `STORE=file` with `DATA_DIR` on a persistent disk                   |
| Settlement stopped for review                 | PayPal's answer was unknown; the journal flags it instead of guessing. See `docs/DEMO.md` 5           |
| Webhooks rejected                             | `PAYPAL_WEBHOOK_ID` must match the sandbox webhook; signatures are verified                           |

## Shared fixtures

Contract fixtures and fake-PayPal scripts live in `packages/shared` and `packages/payments/src/fake`; the server tests and the end-to-end package reuse them.

## Tests

`npm test -w @gavel/server` and `npm run typecheck -w @gavel/server`; heavy runs happen in CI.
