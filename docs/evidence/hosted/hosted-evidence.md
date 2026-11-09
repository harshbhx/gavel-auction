# Hosted API evidence: RECORDED

Run: https://github.com/harshbhx/gavel-auction/actions/runs/42558107791

## Warmup after idle (16 min sleep before each sample), budget 3000 ms: MET

| route    | n   | failed | p50 ms | max ms |
| -------- | --- | ------ | ------ | ------ |
| /warmup  | 2   | 0      | 249.35 | 662.17 |
| /healthz | 2   | 0      | 138.05 | 233.41 |

Each sample is a fresh process with a new connection. The host may never go cold; if every sample is fast, that is the finding. The scheduled uptime workflow can also keep it warm.

## Webhook handler, no verify call (target 300 ms p95): MET

hosted API, client on a GitHub runner, network included; the event type is ignored so no verify call is made and nothing is stored

| n   | p50 ms | p95 ms | p99 ms | max ms |
| --- | ------ | ------ | ------ | ------ |
| 50  | 89.06  | 112.03 | 176.35 | 176.35 |

## Judge smoke (simulated hold path), last 5 runs: 3 success, 2 not

| run                                                                | event    | conclusion | seconds |
| ------------------------------------------------------------------ | -------- | ---------- | ------- |
| https://github.com/harshbhx/gavel-auction/actions/runs/42544303747 | schedule | failure    | 468     |
| https://github.com/harshbhx/gavel-auction/actions/runs/42539975547 | push     | failure    | 493     |
| https://github.com/harshbhx/gavel-auction/actions/runs/42431918057 | schedule | success    | 87      |
| https://github.com/harshbhx/gavel-auction/actions/runs/42322730367 | schedule | success    | 8       |
| https://github.com/harshbhx/gavel-auction/actions/runs/42146223270 | schedule | success    | 9       |

Latest run steps:

| step                                                                 | conclusion | seconds |
| -------------------------------------------------------------------- | ---------- | ------- |
| Set up job                                                           | success    | 1       |
| Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683        | success    | 2       |
| Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020      | success    | 1       |
| Check the inputs                                                     | success    | 0       |
| Wake the API                                                         | success    | 0       |
| Install Playwright and chromium                                      | success    | 23      |
| Walk the judge journey                                               | failure    | 394     |
| Job summary                                                          | success    | 0       |
| Upload screenshots, video, logs                                      | success    | 3       |
| Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | skipped    | 0       |
| Post Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683   | success    | 0       |
| Complete job                                                         | success    | 0       |
