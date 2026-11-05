# Uptime probe and warmup

Requirements: R-QA-045 (uptime and warmup), R-QA-048 (error budget). Keep-alive policy: D-0008.

## Routes probed

- `GET /healthz`: liveness, always 200 while the process runs.
- `GET /readyz`: 200 when migrations are applied and the store answers, else 503.
- `GET /warmup`: runs the warmup steps in parallel (database, PayPal token cache, demo auction) and answers 200 when all are warm within 3000 ms, else 503 with a per-step report.

The route handler is `createWarmupRoute` in `packages/server/src/warmup/warmup.ts`. It is registered in the host in `packages/server/src/boot/compose.ts`.

## Alert rule

`nextProbeState` in `packages/server/src/warmup/probe.ts` counts consecutive failed rounds. A round passes only when every probed route returns 2xx. Two consecutive failed rounds set `alert`; one passing round clears it. The scheduled job turns `alert` into a workflow annotation and a Needs-you entry made by the operator.

Availability for the 99 percent target is the fraction of passing rounds (`availability`).

## Schedule

A scheduled GitHub workflow runs every 5 minutes at best; GitHub may delay scheduled runs. An external free monitor is the primary probe. From D8 until the end of judging the room host must not sleep: use the keep-alive ping every 4 minutes from D-0008, or a paid always-on instance for the final window.

## Scheduled workflow

`.github/workflows/uptime.yml` probes the three routes every 5 minutes. It stays off until the repository variable `UPTIME_ENABLED` is `true` and `PRODUCTION_URL` is set, because it needs the spend approval (Q2) and the keep-alive decision (D-0008). A failed round is an error annotation; when the previous round also failed, the job opens one `Needs you` issue (or comments on the open one).

## Open items

- `/healthz`, `/warmup`, `/ops/summary` and `/metrics/prometheus` are registered in `packages/server/src/boot/compose.ts`. `/warmup` and `/healthz` are open and return only step names and timings; the other two need the operator key.
- The warmup time under 3 s after 15 minutes idle (T-QA-084) is not measured yet; it needs a staging host and the enabled workflow.
