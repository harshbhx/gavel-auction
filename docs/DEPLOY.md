# Deploy staging

Requirements: R-QA-042 (deploy), R-QA-044 (webhook registration). Hosting choices: D-0006 (Node host on Render), D-0007 (web on Cloudflare Pages). Nothing here uses live PayPal; both app environments point at the sandbox.

## What is automated

- `render.yaml` describes one Render web service, `gavel-host`, with one instance and a 1 GB disk at `/var/data`. Build command `npm ci --include=dev --ignore-scripts && npm run build -w @gavel/server` bundles the server and the workspace packages into `packages/server/dist/main.js` with esbuild; start command `npm run start:prod -w @gavel/server` runs `node dist/main.js`, so no dev tooling (vite, vite-node, vitest) is in the runtime. Health check `/healthz`. Boot validation exits 78 and names any missing or invalid required variable (R-QA-043). Auto deploy is off.
- `.github/workflows/deploy-staging.yml` runs on `workflow_dispatch` and on pushes to `main` that touch server code. It runs in the GitHub environment `staging`, calls the Render deploy hook, waits, then runs `scripts/smoke.sh`. With the secrets missing it ends green and prints a notice naming what to add.
- `scripts/smoke.sh <base-url>` checks, with timeouts and a non-zero exit on failure: `GET /healthz` is 200, `GET /warmup` is 200 (a 404 is reported as skipped until the route is registered), an unsigned `POST /webhooks/paypal` is 400, `POST /api/auctions` without a key is 401 and, when `ADMIN_KEY` is set, with the key is 201.

## Manual steps (owner, once)

1. In Render choose New, Blueprint, pick this repository, and apply `render.yaml`. The plan must allow a persistent disk (the `starter` plan does).
2. In the service Environment tab fill the variables the blueprint leaves empty. Names only:
   - `PUBLIC_URL`: the https URL Render gives the service (set after the first deploy, then redeploy).
   - `CORS_ORIGINS`: the origin of the hosted web app.
   - `TOKEN_SECRET`: at least 32 bytes, random.
   - `ADMIN_KEY`: at least 24 characters, random, different from `TOKEN_SECRET`.
   - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: from the PayPal sandbox app.
   - `PAYPAL_WEBHOOK_ID`: from step 5.
3. In Render, Settings, Deploy Hook: copy the hook URL.
4. In GitHub, Settings, Environments, create `staging` and add:
   - secret `RENDER_DEPLOY_HOOK_URL`
   - secret `ADMIN_KEY` (same value as on Render; optional, enables the create-auction smoke)
   - variable `STAGING_URL` (the same https URL as `PUBLIC_URL`)
5. In the PayPal developer dashboard (sandbox app), Webhooks, add `https://<api-host>/webhooks/paypal` with the events the app uses: `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.AUTHORIZATION.DENIED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`. Other event types are acknowledged and ignored, so subscribing to them only spends verification calls. Copy the webhook id into `PAYPAL_WEBHOOK_ID` on Render only. Never commit it.
6. Run the workflow `deploy-staging` by hand and read the smoke output.
7. Web: the static build is hosted as a Cloudflare Worker with static assets (Cloudflare Pages project creation now redirects to Workers). `.github/workflows/deploy-web.yml` runs on `workflow_dispatch` and on pushes to `main` that touch `packages/web`, `packages/shared`, `infra/web` or the workflow. It runs `npm ci && npm run build -w @gavel/web` with `VITE_API_BASE`, `VITE_WS_BASE` (the Render API origin, `https://` and `wss://`), `VITE_SANDBOX=true` and `VITE_PAYPAL_CLIENT_ID` taken from the `PAYPAL_CLIENT_ID` secret (a public sandbox client id), and uploads the artifact `web-dist`. With the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set, it then runs `wrangler deploy` against `infra/web/wrangler.toml` (Worker `gavel-web`, assets directory `./dist`, `not_found_handling = "single-page-application"` so `/join/<room>` and `/r/<room>/bid` serve `index.html`). Without them the deploy job ends green with a notice; download the artifact by hand and deploy it:

   ```
   gh run download <run-id> -n web-dist -D infra/web/dist
   cd infra/web && npx wrangler deploy
   ```

   Then add the Worker origin (for example `https://gavel-web.creharsh.workers.dev`) to `CORS_ORIGINS` on Render, with no trailing slash. The API checks both browser requests and WebSocket upgrades against that list. The web app builds its join links and return route from `window.location.origin`, so `PUBLIC_URL` on Render stays the API origin. The operator key for `/ops` and the demo launcher is typed into the page and is never part of the build.

## Settings the hosted checks need

These workflows stay quiet or fail until the settings exist. Names only, values never go in the repository.

| Workflow                                                                                  | Settings (Settings, Secrets and variables, Actions)                                                                                                                        | Without them                                                               |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `uptime` (probes `/healthz`, `/readyz`, `/warmup` every 5 minutes, see `infra/uptime.md`) | variable `UPTIME_ENABLED` = `true` and variable `PRODUCTION_URL` (the https API origin). Turn it on only after the spend approval (Q2) and the keep-alive choice (D-0008). | The job is skipped: no probe runs and nothing alerts.                      |
| `judge-smoke` (nightly judge walkthrough on the hosted web app)                           | variable `JUDGE_URL` (the https origin of the web app)                                                                                                                     | The nightly run fails red with an error that names `JUDGE_URL`.            |
| `ui-screens-live` (manual screen tour of the hosted site)                                 | run inputs `web_url` and `api_url`; secret `GAVEL_STAGING_ADMIN_KEY` (same value as `ADMIN_KEY` on the host) for the room screens                                          | Only the screens that need no room are taken, and the run summary says so. |

Run the screen tour once both hosts are up: Actions, `ui-screens-live`, Run workflow, then download the artifact `ui-screens-live` (`gh run download <run-id> -n ui-screens-live`). The web app must have been built with `VITE_API_BASE` set to the same `api_url`, and the API must list the web origin in `CORS_ORIGINS`.

## Check by hand

```
ADMIN_KEY=... scripts/smoke.sh https://<api-host>
```

A real signed event reaching the host once G4 runs is checked in the PayPal webhook event list, not by the smoke.

## Rate limits behind one address

Socket upgrades and HTTP joins share one per-address bucket, and every reconnect spends a token. `RATE_JOIN_BURST` (default 40) is the bucket size and `RATE_JOIN_PER_MIN` (default 10) the refill. A venue where many judges share one NAT address can raise `RATE_JOIN_BURST`. Each address may also hold at most 20 open sockets.

## Known limits

- The smoke may pass against the old instance if it answers before the new build is live. The workflow waits 60 seconds first.
- Boot validation that exits 78 on a missing variable (R-QA-043) is not wired into `main.ts` yet; today `config.ts` refuses to boot with a message naming the variable.
