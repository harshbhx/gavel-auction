# Deploy staging

Requirements: R-QA-042 (deploy), R-QA-044 (webhook registration). Hosting choices: D-0006 (Node host on Render), D-0007 (static web hosting on Cloudflare; the web app now runs as a Worker with static assets, see step 7). Nothing here uses live PayPal; both app environments point at the sandbox.

## What is automated

- `render.yaml` describes one Render web service, `gavel-host`, with one instance and a 1 GB disk at `/var/data`. Build command `npm ci --include=dev --ignore-scripts && npm run build -w @gavel/server` bundles the server and the workspace packages into `packages/server/dist/main.js` with esbuild; start command `npm run start:prod -w @gavel/server` runs `node dist/main.js`, so no dev tooling (vite, vite-node, vitest) is in the runtime. Health check `/healthz`. Boot validation exits 78 and names any missing or invalid required variable (R-QA-043). Auto deploy is off.
- `.github/workflows/deploy-staging.yml` runs on `workflow_dispatch` and on pushes to `main` that touch server code. It runs in the GitHub environment `staging`, calls the Render deploy hook, waits, then runs `scripts/smoke.sh`. With the secrets missing it ends green and prints a notice naming what to add.
- `scripts/smoke.sh <base-url>` checks, with timeouts and a non-zero exit on failure: `GET /healthz` is 200, `GET /warmup` is 200 (a 404 is reported as skipped until the route is registered), an unsigned `POST /webhooks/paypal` is 400, `POST /api/auctions` without a key is 401 and, when `ADMIN_KEY` is set, with the key is 201.

## Manual steps (owner, once)

1. In Render choose New, Blueprint, pick this repository, and apply `render.yaml`. The plan must allow a persistent disk (the `starter` plan does).
2. In the service Environment tab fill the variables the blueprint leaves empty. Names only:
   - `PUBLIC_URL`: the https URL Render gives the service (set after the first deploy, then redeploy).
   - `CORS_ORIGINS`: the origin of the hosted web app.
   - `TRUSTED_PROXY_HOPS` is fixed in the blueprint at `2` for Render: Render's own Cloudflare edge and Render's proxy sit in front of the app, so the client is the second entry from the right of `X-Forwarded-For`. It was checked once on 9 Nov 2026 with two probe runners ([evidence](evidence/security/SEC-14/README.md)); use `1` only behind a single proxy, and repeat the probe after any change of the hosting chain.
   - `WEB_ORIGIN` (optional): the origin of the hosted web app, used for every link the API builds (console, screen, invite, receipt). Left out, the first `CORS_ORIGINS` entry is used, then `PUBLIC_URL`.
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
7. Web: the static build is hosted as a Cloudflare Worker with static assets (Cloudflare Pages project creation now redirects to Workers). `.github/workflows/deploy-web.yml` runs on `workflow_dispatch` and on pushes to `main` that touch `packages/web`, `packages/shared`, `infra/web` or the workflow. It runs `npm ci && npm run build -w @gavel/web` with `VITE_API_BASE` set to the API origin, `VITE_WS_BASE` derived from it (`wss://` plus the same host), `VITE_SANDBOX=true` and `VITE_PAYPAL_CLIENT_ID` taken from the `PAYPAL_CLIENT_ID` secret (a public sandbox client id), and uploads the artifact `web-dist`. With the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set, it then runs `wrangler deploy` against `infra/web/wrangler.toml` (Worker `gavel-web`, assets directory `./dist`, `not_found_handling = "single-page-application"` so `/join/<room>` and `/r/<room>/bid` serve `index.html`). Without them the deploy job ends green with a notice; download the artifact by hand and deploy it:

   ```
   gh run download <run-id> -n web-dist -D infra/web/dist
   cd infra/web && npx wrangler deploy
   ```

   Then add the Worker origin (for example `https://gavel.dualmindlab.tech`) to `CORS_ORIGINS` on Render. Each entry is trimmed, lowercased and stripped of a trailing slash; an entry with a path, query, wildcard or a scheme other than http(s) stops the boot with an error naming it. The API checks browser writes, the CORS headers and WebSocket upgrades against one list: `CORS_ORIGINS`, `WEB_ORIGIN` and the API's own `PUBLIC_URL` origin. The web app builds its join links and return route from `window.location.origin`, so `PUBLIC_URL` on Render stays the API origin. The operator key for `/ops` and the demo launcher is typed into the page and is never part of the build.

   To switch the API the web build talks to, either set the repository variable `API_ORIGIN` (Settings, Secrets and variables, Actions, Variables; an `https://` origin with no path and no trailing slash, for example `https://api.example.org`), which applies to every later build, or run `deploy-web` once with the `api_origin` input (`gh workflow run deploy-web.yml -f api_origin=https://api.example.org`), which overrides the variable for that run only. An empty variable and an empty input use the current Render host, `https://api.gavel.dualmindlab.tech`. The build fails if the origin is malformed or the output still points at localhost. Rebuild and redeploy after any change, because the origin is compiled into the bundle.

## Production deploy and rollback

Surfaces and how each is deployed:

| Surface                | Where it runs                                             | How it deploys                                                                                                                                       | Rollback                                                     |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| API and WebSocket host | Render web service `gavel-host`, Starter plan, 1 GB disk  | Manual deploys (auto deploy is off): `deploy-prod` calls the deploy hook after approval                                                              | `deploy-prod` with `rollback=true`                           |
| Web app                | Cloudflare Worker `gavel-web` (`infra/web/wrangler.toml`) | `deploy-web` builds the artifact `web-dist` and runs `wrangler deploy`                                                                               | `npx wrangler rollback` (see `infra/rollback.md`)            |
| Docs site              | Cloudflare, deployed by `docsite.yml` with wrangler       | The `docsite` artifact is published with `wrangler pages deploy` to the project named by the variable `DOCSITE_PAGES_PROJECT` (default `gavel-docs`) | Roll back to a previous deployment (see `infra/rollback.md`) |

### Deploy the API to production

1. Make sure the commit is the head of `main` and CI is green. The deploy hook builds the head of `main`, so the workflow stops early for any other commit.
2. Tag it (`git tag v0.1.0 && git push origin v0.1.0`) or start the workflow by hand: `gh workflow run deploy-prod.yml`.
3. A reviewer approves the run on the GitHub environment `production` (Settings, Environments, production, required reviewers).
4. The job records the live Render deploy id, calls the deploy hook, polls `GET /version` until it serves the commit (15 minutes at most) and runs `scripts/smoke.sh` against `PRODUCTION_URL`. If the commit never appears, it restores the deploy that was live before.

Settings in the `production` environment, names only: secrets `RENDER_API_KEY` and `RENDER_DEPLOY_HOOK_URL`; variables `RENDER_SERVICE_ID` and `PRODUCTION_URL`. Without them the job ends green with a notice and deploys nothing.

### Deploy the web app and the docs site

Both deploy from GitHub Actions on pushes to `main` (`deploy-web.yml` for the Worker, `docsite.yml` for the docs site) and need the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Without them the run ends green and leaves the build as an artifact (`web-dist`, `docsite`) for a manual `wrangler` deploy, as in step 7 above. Artifacts expire, so rebuild if a run is old. The docs site is also served on its own domain; the domain is attached to the Cloudflare project in the Cloudflare dashboard, not in this repository, and a new deploy of the project updates it.

### Roll back

- API: `gh workflow run deploy-prod.yml -f rollback=true` (add `-f rollback_deploy_id=<Render deploy id>` to pick the deploy). Code only; the disk stays as it is.
- Web: `cd infra/web && npx wrangler rollback` restores the previous Worker version, or `npx wrangler rollback <version-id>` a chosen one (`npx wrangler deployments list` shows them).
- Docs site: roll back to an earlier deployment of the Pages project in the Cloudflare dashboard (Workers and Pages, the project, Deployments), or redeploy an earlier `docsite` artifact.

The web build embeds `VITE_API_BASE` at build time, so roll web and API back together when a release changed the protocol between them. Full steps, who can run each and the rehearsal table: [infra/rollback.md](../infra/rollback.md).

## Judge rooms (optional, sandbox hosts only)

A judge with no setup can run a real sandbox auction when the API runs with `JUDGE_ROOMS=true`. The web app asks `GET /api/judge/capabilities` and uses `POST /api/judge/rooms` (no operator key) for "Start a demo auction"; without the flag it falls back to the operator-key demo route and then to the scripted demo. Boot validation refuses the flag unless `PAYPAL_ENV=sandbox`, `PAYPAL_BASE_URL` (when set) is the PayPal sandbox and, on a production-like host, `PAYMENTS=sandbox`. `DEMO_MODE` stays refused in production. Names only, set on Render:

| Variable                  | Default | Meaning                                                                                           |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `JUDGE_ROOMS`             | off     | `true` turns the routes on. Off answers 404.                                                      |
| `JUDGE_ROOMS_PAUSED`      | off     | Boot with creation switched off (the runtime switch is below).                                    |
| `JUDGE_SIM_HOLDS`         | on      | Judge rooms only: a bidder may test with a simulated hold, no PayPal login. `false` turns it off. |
| `JUDGE_ROOMS_MAX`         | 15      | Most rooms live at once (at most 50). Finished rooms free a slot at once.                         |
| `JUDGE_ROOM_TTL_MS`       | 1800000 | Room lifetime before the sweeper ends it (at most 7200000).                                       |
| `JUDGE_ROOMS_PER_IP_HOUR` | 12      | Creates per source address per hour (at most 100). Judges on one NAT share it.                    |
| `JUDGE_ROOMS_PER_HOUR`    | 40      | Creates for the whole host per hour.                                                              |

### Judge key (optional)

`JUDGE_KEY` is a second, limited key for judges. It is not the operator key: it opens nothing but the judge panel's keyed rooms and never reaches an admin route (`ADMIN_KEY` and `JUDGE_KEY` must differ, and boot refuses them equal). Generate it yourself as a random secret of at least 32 characters, set it on Render (`sync: false`, so it is never in the repository), and hand it to judges only in the slide deck. It needs `JUDGE_ROOMS=true`; leave it unset and the panel shows no key field.

| Variable              | Default | Meaning                                                      |
| --------------------- | ------- | ------------------------------------------------------------ |
| `JUDGE_KEY`           | unset   | The limited judge key. Unset or empty turns the feature off. |
| `JUDGE_KEY_ROOMS_MAX` | 3       | Keyed rooms alive at once, for the whole host (at most 10).  |

A holder types the key into the field on the judge panel (`/try`). It is sent in the `x-judge-key` header, kept in `sessionStorage` for that tab only and never put in a URL. With the key, creating a room skips the live-room cap and the per-address limit of the public path, but stays inside `JUDGE_KEY_ROOMS_MAX` live keyed rooms and 20 keyed creates per hour; rooms expire at `JUDGE_ROOM_TTL_MS` as usual and the kill switch below still applies. A wrong key answers 401 and counts toward the same wrong-attempt lockout as a wrong room code (five strikes, 15 minutes), and a locked-out address is refused even with the right key. The key is compared in constant time. The audit log records every keyed action (`judge_room.key_ok`, `judge_room.created` with `via: judge-pass`, `judge_room.refused`) with the source as a short hash, and never the key. To rotate the key, change the variable on Render; rooms already created keep working.

Every judge room also returns a read-only reviewer link (`reviewerLink`): a `reviewer` token (12 hours) that can read the room's public audit trail, snapshot and events, and `GET /api/judge/rooms/:id/ledger`, which builds the hash-chained replay bundle for the in-browser check on `/verify`. It cannot bid, drive the room or mint anything.

Kill switch at runtime: `curl -X POST -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' -d '{"paused":true}' https://<api-host>/api/judge/pause` (send `false` to resume; the state survives a restart). Rooms still running when you pause finish normally or expire at their lifetime. The sandbox buyer logins are not part of the build; they go in the Devpost testing instructions.

## Settings the hosted checks need

These workflows stay quiet or fail until the settings exist. Names only, values never go in the repository.

| Workflow                                                                                  | Settings (Settings, Secrets and variables, Actions)                                                                               | Without them                                                               |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `uptime` (probes `/healthz`, `/readyz`, `/warmup` every 5 minutes, see `infra/uptime.md`) | optional: variable `PRODUCTION_URL` (the https API origin). On by default; set `UPTIME_ENABLED` to `false` to turn it off.        | Falls back to the public domains.                                          |
| `ui-screens-live` (manual screen tour of the hosted site)                                 | run inputs `web_url` and `api_url`; secret `GAVEL_STAGING_ADMIN_KEY` (same value as `ADMIN_KEY` on the host) for the room screens | Only the screens that need no room are taken, and the run summary says so. |

Run the screen tour once both hosts are up: Actions, `ui-screens-live`, Run workflow, then download the artifact `ui-screens-live` (`gh run download <run-id> -n ui-screens-live`). The web app must have been built with `VITE_API_BASE` set to the same `api_url`, and the API must list the web origin in `CORS_ORIGINS`.

## Check by hand

```
ADMIN_KEY=... scripts/smoke.sh https://<api-host>
```

A real signed event reaching the host once G4 runs is checked in the PayPal webhook event list, not by the smoke.

## Rate limits behind one address

Socket upgrades and HTTP joins share one per-address bucket, and every reconnect spends a token. `RATE_JOIN_BURST` (default 40) is the bucket size and `RATE_JOIN_PER_MIN` (default 10) the refill. A venue where many judges share one NAT address can raise `RATE_JOIN_BURST`. Each address may also hold at most 20 open sockets.

Other HTTP requests have two buckets per address. Public reads (GET, HEAD, OPTIONS) use `RATE_HTTP_READ_BURST` (default 300) and `RATE_HTTP_READ_PER_MIN` (default 300), so judges sharing one office address can browse. Every other request uses `RATE_HTTP_BURST` (default 60) and `RATE_HTTP_PER_MIN` (default 60). A refused request answers 429 with `Retry-After` in seconds and the same CORS headers as any other answer, so the web app can show a wait message instead of a network error. Health probes and webhooks are never limited.

## Known limits

- The smoke may pass against the old instance if it answers before the new build is live. The workflow waits 60 seconds first.
- Boot validation exits 78 and names each missing or invalid variable before the server listens (R-QA-043, `packages/server/src/main.ts`).
