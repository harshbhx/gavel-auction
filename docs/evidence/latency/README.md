# Latency evidence

Files written by the `evidence-latency` workflow (`scripts/evidence/latency-report.mjs`) from the raw
output of `measure:sandbox` (per call) and `measure:settlement` (hammer to CAPTURED and SETTLED) on
the real PayPal sandbox. The committed results are never rewritten; a rerun adds a new run.

## How to read the numbers

- `n` is the number of attempts that completed. `failed` is the number of attempts that threw, timed
  out or did not match the PayPal read-back. Attempts = `n` + `failed`. Quote it as "49 of 50
  completed", not as "n=49".
- p50, p95, p99 and max are computed over the completed attempts only, because the measuring tools
  keep a summary and not the raw samples. A failed attempt is usually the slowest one, so these
  percentiles can only understate the real tail.
- Since issue 2324 the report also prints `p95 all attempts`: every failed or timed-out attempt
  counted as the worst case. The tools keep only p50/p95/p99/max of the successes, so this is a bound
  read from that summary (shown as `<= value`), or `unbounded` when the 95th-percentile rank among all
  attempts falls on a failed attempt.
- A span or call with any failed attempt is never `MET`. It reads `MISSED` when even the completed
  samples miss the target and `UNPROVEN` when they meet it. A run with failures is `INCOMPLETE`.
- Targets are the ones in `docs/GATES.md` (hammer to CAPTURED p95 2500 ms, hammer to SETTLED p95
  6000 ms, 1000 ms p95 per call) and are not changed to fit a result.

## What is committed

| Path                                            | What                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `docs/evidence/latency/` (run 42563147792)      | 50 settlements (49 completed), 60 per-call cycles; both targets missed |
| `docs/evidence/measure/measure-settlement.json` | run 42346811713, 20 settlements, 0 failed; the earlier, smaller run    |

The n=3 pilot (run 42346020463) and the n=10 per-call run (42047543821) were not committed as
evidence files, so they are not part of the published open data; `docs/GATES.md` still records them.
The open dataset `gavel-latency` is built from these files directly (`scripts/hf/build-datasets.mjs`).
