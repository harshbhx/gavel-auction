# Voice evaluation report

Git sha: 0085f1480673ea899cf80fd0a75f5aad31d975d1
Mode: live, set: audio, provider: deepgram

G5 fail: exact + recoverable 0.744, wrong accept 0.092

- exact + recoverable 0.744 is below 0.9
- wrong accept 0.092 is above 0.05

G5 failed: the product switches to assist mode, every voice bid requires confirm.

## Summary

| metric          | value   |
| --------------- | ------- |
| n               | 120.000 |
| bidN            | 78.000  |
| noneN           | 24.000  |
| exactRate       | 0.744   |
| wrongAcceptRate | 0.092   |
| confirmRate     | 0.233   |
| recoverableRate | 0.000   |
| missedBidRate   | 0.051   |
| falsePromptRate | 0.042   |
| latencyP50Ms    | 51.000  |
| latencyP95Ms    | 401.000 |

## Per category

| category | n   | exact | wrong accept | confirm |
| -------- | --- | ----- | ------------ | ------- |
| snr10    | 40  | 0.731 | 0.100        | 0.250   |
| snr20    | 40  | 0.885 | 0.075        | 0.150   |
| snr5     | 40  | 0.615 | 0.100        | 0.300   |

## Threshold sweep (AUTO)

| threshold | wrong accept | confirm |
| --------- | ------------ | ------- |
| 0.70      | 0.092        | 0.233   |
| 0.75      | 0.092        | 0.233   |
| 0.80      | 0.092        | 0.233   |
| 0.85      | 0.092        | 0.233   |
| 0.90      | 0.092        | 0.233   |
| 0.95      | 0.092        | 0.233   |

## Room gate (AUTO/CONFIRM)

Outcome after the room pipeline: rules parse, rescoring, validation, AUTO/CONFIRM policy and mic rule.

Mic rule: room. Roster of paddles 1 to 99 with active holds; price 0 and minimum increment 100 cents where the fixture gives none; neutral speech-to-text confidence where none was recorded; model off, so every bid is rules-only.

| outcome | n   |
| ------- | --- |
| auto    | 0   |
| confirm | 85  |
| drop    | 35  |

Auto-accepted bids: 0, of which wrong: 0 (rate 0.000, 0 when nothing was auto-accepted).

| stt confidence | n   |
| -------------- | --- |
| recorded       | 0   |
| neutralAssumed | 120 |

| metric          | value   |
| --------------- | ------- |
| n               | 120.000 |
| bidN            | 78.000  |
| noneN           | 24.000  |
| exactRate       | 0.000   |
| wrongAcceptRate | 0.000   |
| confirmRate     | 0.708   |
| recoverableRate | 0.744   |
| missedBidRate   | 0.115   |
| falsePromptRate | 0.042   |
| latencyP50Ms    | 51.000  |
| latencyP95Ms    | 401.000 |

### Threshold sweep after the gate

| threshold | wrong accept | confirm |
| --------- | ------------ | ------- |
| 0.70      | 0.000        | 0.708   |
| 0.75      | 0.000        | 0.708   |
| 0.80      | 0.000        | 0.708   |
| 0.85      | 0.000        | 0.708   |
| 0.90      | 0.000        | 0.708   |
| 0.95      | 0.000        | 0.708   |

## Confusions

| id             | kind                | expected     | actual                   |
| -------------- | ------------------- | ------------ | ------------------------ |
| h01-s10-babble | wrong_accept        | bid 4 40000  | accept 4 400             |
| h01-s20-babble | missed_bid          | bid 4 40000  | none                     |
| h01-s5-babble  | missed_bid          | bid 4 40000  | none                     |
| h05-s5-babble  | unrecovered_confirm | bid 6 130000 | confirm 6 100 / 6 100300 |
| h07-s10-babble | unrecovered_confirm | bid 5 90000  | confirm                  |
| h07-s5-babble  | unrecovered_confirm | bid 5 90000  | confirm                  |
| h11-s10-babble | missed_bid          | bid 3 110000 | none                     |
| h11-s5-babble  | unrecovered_confirm | bid 3 110000 | confirm                  |
| h13-s20-babble | wrong_accept        | bid 6 82500  | accept 6 82000           |
| h13-s5-babble  | wrong_accept        | bid 6 82500  | accept 6 2500            |
| h16-s10-room   | unrecovered_confirm | bid 11 45000 | confirm                  |
| h16-s5-room    | unrecovered_confirm | bid 11 45000 | confirm                  |
| h17-s5-babble  | missed_bid          | bid 6 50000  | none                     |
| h18-s10-room   | unrecovered_confirm | bid 13 60000 | confirm                  |
| h18-s20-room   | unrecovered_confirm | bid 13 60000 | confirm                  |
| h18-s5-room    | unrecovered_confirm | bid 13 60000 | confirm                  |
| h20-s10-room   | unrecovered_confirm | bid 15 80000 | confirm                  |
| h23-s10-babble | unrecovered_confirm | bid 16 20000 | confirm                  |
| h23-s5-babble  | unrecovered_confirm | bid 16 20000 | confirm                  |
| h25-s5-babble  | wrong_accept        | bid 5 260000 | accept 5 2600            |
| h34-s10-room   | wrong_accept        | none         | accept 7 60000           |
| h35-s10-babble | wrong_accept        | none         | accept 7 300             |
| h35-s20-babble | wrong_accept        | none         | accept 7 300             |
| h35-s5-babble  | wrong_accept        | none         | accept 7 300             |
| h36-s5-room    | false_prompt        | none         | confirm 7 40000          |
| h40-s10-room   | wrong_accept        | none         | accept 7 20000           |
| h40-s20-room   | wrong_accept        | none         | accept 7 20000           |
| h40-s5-room    | wrong_accept        | none         | accept 7 20000           |

## Per utterance

| id             | category | expected      | actual                    | confidence | latency ms |
| -------------- | -------- | ------------- | ------------------------- | ---------- | ---------- |
| h01-s10-babble | snr10    | bid 4 40000   | accept 4 400              | 1.000      | 519        |
| h01-s20-babble | snr20    | bid 4 40000   | none                      | 0.500      | 183        |
| h01-s5-babble  | snr5     | bid 4 40000   | none                      | 0.500      | 61         |
| h02-s10-room   | snr10    | bid 5 60000   | accept 5 60000            | 1.000      | 48         |
| h02-s20-room   | snr20    | bid 5 60000   | accept 5 60000            | 1.000      | 52         |
| h02-s5-room    | snr5     | bid 5 60000   | accept 5 60000            | 1.000      | 55         |
| h03-s10-babble | snr10    | bid 3 65000   | accept 3 65000            | 1.000      | 187        |
| h03-s20-babble | snr20    | bid 3 65000   | accept 3 65000            | 1.000      | 53         |
| h03-s5-babble  | snr5     | bid 3 65000   | accept 3 65000            | 1.000      | 50         |
| h04-s10-room   | snr10    | bid 4 87500   | accept 4 87500            | 1.000      | 43         |
| h04-s20-room   | snr20    | bid 4 87500   | accept 4 87500            | 1.000      | 58         |
| h04-s5-room    | snr5     | bid 4 87500   | accept 4 87500            | 1.000      | 80         |
| h05-s10-babble | snr10    | bid 6 130000  | accept 6 130000           | 1.000      | 41         |
| h05-s20-babble | snr20    | bid 6 130000  | accept 6 130000           | 1.000      | 101        |
| h05-s5-babble  | snr5     | bid 6 130000  | confirm 6 100 / 6 100300  | 0.500      | 49         |
| h06-s10-room   | snr10    | bid 8 32500   | accept 8 32500            | 1.000      | 455        |
| h06-s20-room   | snr20    | bid 8 32500   | accept 8 32500            | 1.000      | 56         |
| h06-s5-room    | snr5     | bid 8 32500   | accept 8 32500            | 1.000      | 56         |
| h07-s10-babble | snr10    | bid 5 90000   | confirm                   | 0.500      | 57         |
| h07-s20-babble | snr20    | bid 5 90000   | accept 5 90000            | 1.000      | 49         |
| h07-s5-babble  | snr5     | bid 5 90000   | confirm                   | 0.500      | 52         |
| h08-s10-room   | snr10    | bid 6 75000   | accept 6 75000            | 1.000      | 51         |
| h08-s20-room   | snr20    | bid 6 75000   | accept 6 75000            | 1.000      | 52         |
| h08-s5-room    | snr5     | bid 6 75000   | accept 6 75000            | 1.000      | 51         |
| h09-s10-babble | snr10    | bid 4 42500   | accept 4 42500            | 1.000      | 91         |
| h09-s20-babble | snr20    | bid 4 42500   | accept 4 42500            | 1.000      | 42         |
| h09-s5-babble  | snr5     | bid 4 42500   | accept 4 42500            | 1.000      | 50         |
| h10-s10-room   | snr10    | bid 8 67500   | accept 8 67500            | 1.000      | 58         |
| h10-s20-room   | snr20    | bid 8 67500   | accept 8 67500            | 1.000      | 42         |
| h10-s5-room    | snr5     | bid 8 67500   | accept 8 67500            | 1.000      | 243        |
| h11-s10-babble | snr10    | bid 3 110000  | none                      | 0.500      | 392        |
| h11-s20-babble | snr20    | bid 3 110000  | accept 3 110000           | 1.000      | 50         |
| h11-s5-babble  | snr5     | bid 3 110000  | confirm                   | 0.500      | 49         |
| h12-s10-room   | snr10    | bid 5 145000  | accept 5 145000           | 1.000      | 52         |
| h12-s20-room   | snr20    | bid 5 145000  | accept 5 145000           | 1.000      | 281        |
| h12-s5-room    | snr5     | bid 5 145000  | accept 5 145000           | 1.000      | 53         |
| h13-s10-babble | snr10    | bid 6 82500   | accept 6 82500            | 1.000      | 57         |
| h13-s20-babble | snr20    | bid 6 82500   | accept 6 82000            | 1.000      | 50         |
| h13-s5-babble  | snr5     | bid 6 82500   | accept 6 2500             | 1.000      | 45         |
| h14-s10-room   | snr10    | bid 4 95000   | accept 4 95000            | 1.000      | 45         |
| h14-s20-room   | snr20    | bid 4 95000   | accept 4 95000            | 1.000      | 50         |
| h14-s5-room    | snr5     | bid 4 95000   | accept 4 95000            | 1.000      | 44         |
| h15-s10-babble | snr10    | bid 8 170000  | accept 8 170000           | 1.000      | 56         |
| h15-s20-babble | snr20    | bid 8 170000  | accept 8 170000           | 1.000      | 408        |
| h15-s5-babble  | snr5     | bid 8 170000  | accept 8 170000           | 1.000      | 43         |
| h16-s10-room   | snr10    | bid 11 45000  | confirm                   | 0.500      | 51         |
| h16-s20-room   | snr20    | bid 11 45000  | accept 11 45000           | 1.000      | 51         |
| h16-s5-room    | snr5     | bid 11 45000  | confirm                   | 0.500      | 51         |
| h17-s10-babble | snr10    | bid 6 50000   | accept 6 50000            | 1.000      | 52         |
| h17-s20-babble | snr20    | bid 6 50000   | accept 6 50000            | 1.000      | 51         |
| h17-s5-babble  | snr5     | bid 6 50000   | none                      | 0.500      | 399        |
| h18-s10-room   | snr10    | bid 13 60000  | confirm                   | 0.500      | 55         |
| h18-s20-room   | snr20    | bid 13 60000  | confirm                   | 0.500      | 61         |
| h18-s5-room    | snr5     | bid 13 60000  | confirm                   | 0.500      | 59         |
| h19-s10-babble | snr10    | bid 8 75000   | accept 8 75000            | 1.000      | 50         |
| h19-s20-babble | snr20    | bid 8 75000   | accept 8 75000            | 1.000      | 58         |
| h19-s5-babble  | snr5     | bid 8 75000   | accept 8 75000            | 1.000      | 51         |
| h20-s10-room   | snr10    | bid 15 80000  | confirm                   | 0.500      | 401        |
| h20-s20-room   | snr20    | bid 15 80000  | accept 15 80000           | 1.000      | 54         |
| h20-s5-room    | snr5     | bid 15 80000  | accept 15 80000           | 1.000      | 44         |
| h21-s10-babble | snr10    | bid 3 37500   | accept 3 37500            | 1.000      | 57         |
| h21-s20-babble | snr20    | bid 3 37500   | accept 3 37500            | 1.000      | 445        |
| h21-s5-babble  | snr5     | bid 3 37500   | accept 3 37500            | 1.000      | 48         |
| h22-s10-room   | snr10    | bid 10 100000 | accept 10 100000          | 1.000      | 58         |
| h22-s20-room   | snr20    | bid 10 100000 | accept 10 100000          | 1.000      | 53         |
| h22-s5-room    | snr5     | bid 10 100000 | accept 10 100000          | 1.000      | 46         |
| h23-s10-babble | snr10    | bid 16 20000  | confirm                   | 0.500      | 49         |
| h23-s20-babble | snr20    | bid 16 20000  | accept 16 20000           | 1.000      | 53         |
| h23-s5-babble  | snr5     | bid 16 20000  | confirm                   | 0.500      | 386        |
| h24-s10-room   | snr10    | bid 4 200000  | accept 4 200000           | 1.000      | 51         |
| h24-s20-room   | snr20    | bid 4 200000  | accept 4 200000           | 1.000      | 41         |
| h24-s5-room    | snr5     | bid 4 200000  | accept 4 200000           | 1.000      | 51         |
| h25-s10-babble | snr10    | bid 5 260000  | accept 5 260000           | 1.000      | 49         |
| h25-s20-babble | snr20    | bid 5 260000  | accept 5 260000           | 1.000      | 48         |
| h25-s5-babble  | snr5     | bid 5 260000  | accept 5 2600             | 1.000      | 40         |
| h26-s10-room   | snr10    | bid 6 350000  | accept 6 350000           | 1.000      | 335        |
| h26-s20-room   | snr20    | bid 6 350000  | accept 6 350000           | 1.000      | 443        |
| h26-s5-room    | snr5     | bid 6 350000  | accept 6 350000           | 1.000      | 77         |
| h27-s10-babble | snr10    | confirm       | none                      | 0.500      | 61         |
| h27-s20-babble | snr20    | confirm       | none                      | 0.500      | 215        |
| h27-s5-babble  | snr5     | confirm       | none                      | 0.500      | 47         |
| h28-s10-room   | snr10    | confirm       | confirm 7 50000           | 0.500      | 45         |
| h28-s20-room   | snr20    | confirm       | confirm 7 50000           | 0.500      | 52         |
| h28-s5-room    | snr5     | confirm       | confirm 7 50000           | 0.500      | 41         |
| h29-s10-babble | snr10    | confirm       | confirm 7 60000 / 7 65000 | 0.500      | 50         |
| h29-s20-babble | snr20    | confirm       | confirm 7 60000 / 7 65000 | 0.500      | 144        |
| h29-s5-babble  | snr5     | confirm       | confirm 7 60000 / 7 65000 | 0.500      | 53         |
| h30-s10-room   | snr10    | confirm       | confirm 4 30000 / 9 32500 | 0.500      | 49         |
| h30-s20-room   | snr20    | confirm       | confirm 4 30000 / 9 32500 | 0.500      | 57         |
| h30-s5-room    | snr5     | confirm       | confirm 4 30000 / 9 32500 | 0.500      | 54         |
| h31-s10-babble | snr10    | confirm       | confirm 7 70000           | 0.500      | 42         |
| h31-s20-babble | snr20    | confirm       | confirm 7 70000           | 0.500      | 48         |
| h31-s5-babble  | snr5     | confirm       | confirm 7 70000           | 0.500      | 45         |
| h32-s10-room   | snr10    | confirm       | confirm                   | 0.500      | 47         |
| h32-s20-room   | snr20    | confirm       | confirm                   | 0.500      | 42         |
| h32-s5-room    | snr5     | confirm       | confirm                   | 0.500      | 45         |
| h33-s10-babble | snr10    | none          | none                      | 0.500      | 122        |
| h33-s20-babble | snr20    | none          | none                      | 0.500      | 44         |
| h33-s5-babble  | snr5     | none          | none                      | 0.500      | 50         |
| h34-s10-room   | snr10    | none          | accept 7 60000            | 1.000      | 46         |
| h34-s20-room   | snr20    | none          | none                      | 0.500      | 43         |
| h34-s5-room    | snr5     | none          | none                      | 0.500      | 41         |
| h35-s10-babble | snr10    | none          | accept 7 300              | 1.000      | 44         |
| h35-s20-babble | snr20    | none          | accept 7 300              | 1.000      | 49         |
| h35-s5-babble  | snr5     | none          | accept 7 300              | 1.000      | 43         |
| h36-s10-room   | snr10    | none          | none                      | 0.500      | 42         |
| h36-s20-room   | snr20    | none          | none                      | 0.500      | 54         |
| h36-s5-room    | snr5     | none          | confirm 7 40000           | 0.500      | 49         |
| h37-s10-babble | snr10    | none          | none                      | 0.500      | 40         |
| h37-s20-babble | snr20    | none          | none                      | 0.500      | 41         |
| h37-s5-babble  | snr5     | none          | none                      | 0.500      | 41         |
| h38-s10-room   | snr10    | none          | none                      | 0.500      | 40         |
| h38-s20-room   | snr20    | none          | none                      | 0.500      | 39         |
| h38-s5-room    | snr5     | none          | none                      | 0.500      | 42         |
| h39-s10-babble | snr10    | none          | none                      | 0.500      | 43         |
| h39-s20-babble | snr20    | none          | none                      | 0.500      | 44         |
| h39-s5-babble  | snr5     | none          | none                      | 0.500      | 51         |
| h40-s10-room   | snr10    | none          | accept 7 20000            | 1.000      | 46         |
| h40-s20-room   | snr20    | none          | accept 7 20000            | 1.000      | 40         |
| h40-s5-room    | snr5     | none          | accept 7 20000            | 1.000      | 461        |
