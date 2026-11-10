# Load and race results

Real results of the load harness in `packages/e2e/src/load` (scenarios L1 to L5, R-QA-030), run in
GitHub Actions on `main` on 10 Nov 2026. Nothing here was measured on a developer machine. The
harness runs the server in process on a fake PayPal, so these numbers are about the GAVEL server code on a
shared 2 vCPU `ubuntu-latest` runner. They are not numbers for the hosted API, the network or PayPal.

Source commit: `5c931c76` (`main`, 10 Nov 2026).

## Summary

| Scenario | What it does                                        | Result                                                                                                                       | Verdict                          |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| L1       | 100 simulated bidders, 300 bids in rounds           | p95 ack 309.65 ms (limit 250), p99 328.52 ms (limit 600), RSS growth 176.1 MB (limit 150), 0 lost, 0 duplicate               | **MISSED** (p95 and RSS)         |
| L2       | 100 bidders send the identical bid at once          | exactly 1 accepted, 99 rejected, 0 lost, 0 duplicate; p95 ack 181.58 ms, p99 188.45 ms; RSS growth 165.3 MB (limit 150)      | correctness PASS, RSS **MISSED** |
| L3       | 500 hammer races, 6 bidders each                    | one winner per race, 0 lost, 0 duplicate, ledger chain verifies, 0 violations; peak RSS 329 MB                               | PASS                             |
| L4       | webhook storm: 50 duplicate deliveries of one event | 50 of 50 answered 200, no server error, exactly 1 event stored; peak RSS 192 MB                                              | PASS (in process, fake PayPal)   |
| L5       | 30 minute soak, 20 bidders                          | 4525 rounds, 271500 bids sent, 0 lost, 0 duplicate, 0 unhandled rejections, heap growth 16.9 MB (limit 150); peak RSS 216 MB | PASS                             |

## The misses, stated plainly

- **L1 misses two of its limits on the CI runner.** p95 ack is 309.65 ms against 250 ms, and RSS growth is
  176.1 MB against 150 MB. p99 (328.52 ms against 600 ms), the lost-bid check and the duplicate-reply check pass.
  L2 shows the same RSS miss (165.3 MB), and its p95 (181.58 ms) is inside the limit.
- The thresholds were **not changed**. `load.yml` already marks L1 and the L2 timing and RSS checks as
  report-only on shared runners (see the comment at the top of that file); only the correctness checks block.
  Whether the 250 ms and 150 MB limits should stay as written, be re-measured on a quieter machine, or be
  amended is a decision for the project owner. It is not made here.
- The RSS figure for L1 and L2 is the growth of the whole process during a short run, which includes the
  allocator warming up. L5 over 30 minutes grew only 16.9 MB after a forced collection, so the L1 and L2
  growth is not evidence of a leak, but that is an interpretation, not a measurement of the cause.

## Runs

| Run                                                                | Workflow                                                          | Result                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------- |
| https://github.com/harshbhx/gavel-auction/actions/runs/42764822552 | `load` (L1, L2), artifact `load-latency`                          | green job; L1 checks failed as shown above (report-only) |
| https://github.com/harshbhx/gavel-auction/actions/runs/42764830045 | `load-soak` (L3, L4, L5 with `minutes=30`), artifact `load-l3-l5` | success, wall time 31 min 26 s                           |

A green `load` job does not mean L1 passed: its L1 step is `continue-on-error`. Read the artifact, as this
page does.

## What is not covered

- L4 runs against the in process server and the fake PayPal. No webhook storm was sent to the hosted API
  (`https://api.gavel.dualmindlab.tech`), so the hosted webhook handler has no storm result. The hosted
  single-route timing is in `docs/GATES.md` (hosted evidence, n=50).
- One run of each scenario. There is no repeat count, so no spread is claimed.
- No browser clients: the bidders are socket clients in the harness.
