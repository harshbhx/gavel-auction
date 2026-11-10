# Uptime probe and warmup

Requirements: R-QA-045 (uptime and warmup), R-QA-048 (error budget). Keep-alive policy: D-0008.

## Routes probed

- `GET /healthz`: liveness, always 200 while the process runs.
- `GET /readyz`: 200 when migrations are applied and the store answers, else 503.
- `GET /warmup`: runs the warmup steps in parallel (database, PayPal token cache, demo auction) and answers 200 when all are warm within 3000 ms, else 503 with a per-step report. The scheduled workflow also fails a round when `/warmup` answers 2xx but took longer than 3000 ms (`WARMUP_BUDGET_MS`), because runs are hours apart and the host has been idle, which is the T-QA-084 case.

The route handler is `createWarmupRoute` in `packages/server/src/warmup/warmup.ts`. It is registered in the host in `packages/server/src/boot/compose.ts`.

## Alert rule

`nextProbeState` in `packages/server/src/warmup/probe.ts` counts consecutive failed rounds. A round passes only when every probed route returns 2xx. Two consecutive failed rounds set `alert`; one passing round clears it. That rule fits a probe that runs every few minutes, such as an external monitor.

The scheduled GitHub workflow does not use it. Its runs are hours apart, so waiting for a second failed run would delay an alert by most of a day. Instead the job re-probes once after 30 seconds inside the same run and, when the failure stands, opens the Needs-you issue at once.

Availability for the 99 percent target is the fraction of passing rounds (`availability`).

## Schedule

The scheduled GitHub workflow asks for a run every 15 minutes, but GitHub treats cron as best effort. Measured on this repository (`gh run list -w uptime`, 6 to 9 Nov 2026): 16 scheduled runs in about 3.4 days, one every 4 to 8 hours, most of them skipped while the `UPTIME_ENABLED` variable was missing. It is a coarse background check, not a 5-minute probe, and it cannot keep the host warm.

Nothing in this repository configures an external monitor yet. Until one exists there is no minute-level probe and no keep-alive ping. Decision D-0008 (a keep-alive ping every 4 minutes) is therefore not implemented. The Render service runs on the Starter plan (`docs/DEPLOY.md`), which does not spin down on idle, so the ping is not needed there; the warmup figures in this file do not depend on one.

### External monitor (recommended, not set up)

Any of these fires reliably, unlike GitHub cron. Point it at `/healthz`, `/readyz`, `/warmup` and the web and docs URLs, alert on two failed checks in a row, and record its public status URL here once it exists:

- UptimeRobot or Better Stack free tier, HTTP checks every 1 to 5 minutes.
- A Cloudflare Worker with a cron trigger (`crons = ["*/5 * * * *"]` in `wrangler.toml`) whose `scheduled` handler fetches the routes and posts to a webhook or opens a GitHub issue through the REST API with a fine-grained token. Cloudflare cron triggers run on schedule; this repository already deploys Workers.

Status: not configured. The owner decides which service to use and holds the account (open question for Harsh: UptimeRobot or Better Stack free tier, or the Cloudflare Worker cron). Once chosen, record the service, the check list and the public status URL here and amend D-0008 in `docs/DECISIONS.md`. Nothing in this repository creates that account or spends money.

## Scheduled workflow

`.github/workflows/uptime.yml` probes the API routes plus the web and docs hosts on GitHub's best-effort schedule (requested every 15 minutes, observed every 4 to 8 hours). It is on by default; set the repository variable `UPTIME_ENABLED` to `false` to turn it off. `PRODUCTION_URL`, `WEB_URL` and `DOCS_URL` override the default origins. Each round writes a status and timing table to the job summary, which is the report T-QA-084 asks for. A failed round is re-probed after 30 seconds; when the failure stands the job fails with an error annotation and opens one `Needs you` issue (or comments on the open one).

## Open items

- `/healthz`, `/warmup`, `/ops/summary` and `/metrics/prometheus` are registered in `packages/server/src/boot/compose.ts`. `/warmup` and `/healthz` are open and return only step names and timings; the other two need the operator key.
- The warmup time under 3 s after 15 minutes idle (T-QA-084): measured once on the hosted API in workflow `evidence-hosted`, run 42558107791 (9 Nov 2026): n=2 samples after 16 minutes idle, max 662.17 ms for `/warmup`, within the 3000 ms budget. Caveats: two samples only; the uptime workflow runs only every few hours, so it does not keep the host warm, and the host is on the Starter plan, which does not spin down on idle; the owner redeployed Render during the run (about 03:50 UTC). Evidence: `docs/evidence/hosted/` (sha256 in `docs/GATES.md`).
