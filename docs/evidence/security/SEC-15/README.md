# SEC-15 log scan, run 42566851766

Artifact `sec15-log-scan` of workflow `evidence-log-scan` on `main`, run https://github.com/harshbhx/gavel-auction/actions/runs/42566851766 (9 Nov 2026). Scenario S01 on the real server (stack mode, fake payments, CI runner), six probe requests, then a scan of the server log and the data folder for nine canary values and patterns.

| File                    | sha256                                                           | What it is                                                                  |
| ----------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `log-scan.json`         | 6c3cb943e209e6956b232ccfabfbab164111c4b39d1dff2bbb7a6d8961627127 | Scan result: PASS, 43 log lines, 0 findings, 9 canaries, six store files    |
| `negative-control.json` | 9d65d814d84078cbbf3da8de554645e9a36e8232762326a535debad9768373a2 | Same scanner on a log with one canary added: FAIL, 1 finding (required)     |
| `run.json`              | 5d9548a54a38893d931a477d48f901cc2cd77752807a20d8ed49b36ef0790f98 | S01 outcome and the six probe statuses                                      |
| `run.txt`               | 98ad3335324a9ee8888b2f469ce29b7c22e6506bef4126e381dd27816dc8d212 | Console output of the scan command                                          |
| `server.log`            | 96f3c9a16d021877f97b00330fbfc857c768fac91d80d2c620e199e9769402e7 | The scanned server log (43 lines; its hash is the one recorded in the scan) |
| `verdict.txt`           | b755851af501a680cbd583e69f1f1ea48aa13502b58682ac5ecd56be05c48a37 | The verdict lines                                                           |

`negative-control.json` was re-laid out by prettier; the artifact copy differs only in line layout. The leaky log of the negative control is not in the artifact.

Not covered: Render service logs, raw audio transcripts (S01 sends no audio), any route or error path the run does not call, the real PayPal sandbox payments mode (this run used `PAYMENTS=fake`), and other scenarios.
