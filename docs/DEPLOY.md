# Deploy staging

Requirements: R-QA-042 (deploy), R-QA-044 (webhook registration). Hosting choices: D-0006 (Node host on Render), D-0007 (web on Cloudflare Pages). Nothing here uses live PayPal; both app environments point at the sandbox.

## What is automated

- `render.yaml` describes one Render web service, `gavel-host`, with one instance and a 1 GB disk at `/var/data`. Build command `npm ci --include=dev && npm run build -w @gavel/server` bundles the server and the workspace packages into `packages/server/dist/main.js` with esbuild; start command `npm run start:prod -w @gavel/server` runs `node dist/main.js`, so no dev tooling (vite, vite-node, vitest) is in the runtime. Health check `/healthz`. Boot validation exits 78 and names any missing or invalid required variable (R-QA-043). Auto deploy is off.
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
5. In the PayPal developer dashboard (sandbox app), Webhooks, add `https://<api-host>/webhooks/paypal` with the events the app uses: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`. Copy the webhook id into `PAYPAL_WEBHOOK_ID` on Render only. Never commit it.
6. Run the workflow `deploy-staging` by hand and read the smoke output.
7. Web: create a Cloudflare Pages project, build `npm ci && npm run build -w @gavel/web` with the API origin passed in `VITE_API_BASE` and `VITE_WS_BASE`, and add the Pages origin to `CORS_ORIGINS`. A workflow for this is not part of this change.

## Check by hand

```
ADMIN_KEY=... scripts/smoke.sh https://<api-host>
```

A real signed event reaching the host once G4 runs is checked in the PayPal webhook event list, not by the smoke.

## Known limits

- The smoke may pass against the old instance if it answers before the new build is live. The workflow waits 60 seconds first.
- Boot validation that exits 78 on a missing variable (R-QA-043) is not wired into `main.ts` yet; today `config.ts` refuses to boot with a message naming the variable.
