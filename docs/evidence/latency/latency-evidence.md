# Latency evidence: INCOMPLETE

Run: https://github.com/harshbhx/gavel-auction/actions/runs/42563147792

## Per call (60 of 60 cycles completed)

| call      | n   | failed | p50 ms  | p95 ms  | p99 ms  | max ms  | p95 vs 1000 ms |
| --------- | --- | ------ | ------- | ------- | ------- | ------- | -------------- |
| order     | 60  | 0      | 759.42  | 1227.49 | 1473.48 | 1473.48 | MISSED         |
| authorize | 60  | 0      | 1308.01 | 1538.31 | 1911.93 | 1911.93 | MISSED         |
| capture   | 59  | 3      | 2093.26 | 2718.84 | 3724.76 | 3724.76 | MISSED         |
| void      | 60  | 0      | 947.66  | 1249.84 | 1458.67 | 1458.67 | MISSED         |

## End to end (50 settlements, 6 holds each, 299 authorizations)

| span               | n   | failed | p50 ms  | p95 ms  | p99 ms  | max ms  | p95 target      |
| ------------------ | --- | ------ | ------- | ------- | ------- | ------- | --------------- |
| hammer to CAPTURED | 49  | 1      | 2784.72 | 3766.67 | 5094.52 | 5094.52 | 2500 ms: MISSED |
| hammer to SETTLED  | 49  | 1      | 5577.1  | 6927.43 | 8622.66 | 8622.66 | 6000 ms: MISSED |

## Problems

- per-call capture had 3 failed calls
- settlement had 0 mismatches and 1 errors
