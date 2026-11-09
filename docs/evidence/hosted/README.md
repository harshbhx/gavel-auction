# Hosted evidence, run 42558107791

Files from the artifacts `hosted-evidence` and `webhook-handler-evidence` of workflow `evidence-hosted`, run https://github.com/harshbhx/gavel-auction/actions/runs/42558107791 (9 Nov 2026, started 03:45 UTC). The sha256 values are in `docs/GATES.md`.

- `hosted-evidence.json`, `hosted-evidence.md`: the combined report (warmup after idle, webhook route, judge smoke list).
- `warmup-samples.json`: the four warmup and healthz samples (two idle periods of 16 minutes).
- `webhook.json`: 50 timings of the hosted webhook route, GitHub runner network included.
- `webhook-handler.json`: 500 timings of the handler on loopback.
- `judge.json`: the last five judge-smoke runs as listed at the time. Three of them are older smoke runs that only loaded the landing page (8 to 87 seconds). They are not evidence of the judge journey; the journey state is in `docs/GATES.md`.

The owner redeployed Render during the run (about 03:50 UTC), which can skew the warmup samples.
