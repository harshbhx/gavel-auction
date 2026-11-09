# Voice evaluation report

Git sha: 0085f1480673ea899cf80fd0a75f5aad31d975d1
Mode: live, set: audio, provider: groq

G5 fail: exact + recoverable 0.923, wrong accept 0.058

- wrong accept 0.058 is above 0.05

G5 failed: the product switches to assist mode, every voice bid requires confirm.

## Summary

| metric          | value   |
| --------------- | ------- |
| n               | 120.000 |
| bidN            | 78.000  |
| noneN           | 24.000  |
| exactRate       | 0.885   |
| wrongAcceptRate | 0.058   |
| confirmRate     | 0.175   |
| recoverableRate | 0.038   |
| missedBidRate   | 0.051   |
| falsePromptRate | 0.000   |
| latencyP50Ms    | 252.000 |
| latencyP95Ms    | 361.000 |

## Per category

| category | n   | exact | wrong accept | confirm |
| -------- | --- | ----- | ------------ | ------- |
| snr10    | 40  | 0.962 | 0.050        | 0.175   |
| snr20    | 40  | 1.000 | 0.050        | 0.150   |
| snr5     | 40  | 0.692 | 0.075        | 0.200   |

## Threshold sweep (AUTO)

| threshold | wrong accept | confirm |
| --------- | ------------ | ------- |
| 0.70      | 0.058        | 0.175   |
| 0.75      | 0.058        | 0.175   |
| 0.80      | 0.058        | 0.175   |
| 0.85      | 0.058        | 0.175   |
| 0.90      | 0.058        | 0.175   |
| 0.95      | 0.058        | 0.175   |

## Room gate (AUTO/CONFIRM)

Outcome after the room pipeline: rules parse, rescoring, validation, AUTO/CONFIRM policy and mic rule.

Mic rule: room. Roster of paddles 1 to 99 with active holds; price 0 and minimum increment 100 cents where the fixture gives none; neutral speech-to-text confidence where none was recorded; model off, so every bid is rules-only.

| outcome | n   |
| ------- | --- |
| auto    | 0   |
| confirm | 90  |
| drop    | 30  |

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
| confirmRate     | 0.750   |
| recoverableRate | 0.923   |
| missedBidRate   | 0.064   |
| falsePromptRate | 0.000   |
| latencyP50Ms    | 252.000 |
| latencyP95Ms    | 361.000 |

### Threshold sweep after the gate

| threshold | wrong accept | confirm |
| --------- | ------------ | ------- |
| 0.70      | 0.000        | 0.750   |
| 0.75      | 0.000        | 0.750   |
| 0.80      | 0.000        | 0.750   |
| 0.85      | 0.000        | 0.750   |
| 0.90      | 0.000        | 0.750   |
| 0.95      | 0.000        | 0.750   |

## Confusions

| id             | kind                | expected     | actual                  |
| -------------- | ------------------- | ------------ | ----------------------- |
| h01-s5-babble  | missed_bid          | bid 4 40000  | none                    |
| h05-s5-babble  | wrong_accept        | bid 6 130000 | accept 6 100300         |
| h07-s5-babble  | missed_bid          | bid 5 90000  | none                    |
| h11-s5-babble  | missed_bid          | bid 3 110000 | none                    |
| h17-s5-babble  | unrecovered_confirm | bid 6 50000  | confirm 6 10000 / 60000 |
| h23-s5-babble  | missed_bid          | bid 16 20000 | none                    |
| h35-s10-babble | wrong_accept        | none         | accept 7 300            |
| h35-s20-babble | wrong_accept        | none         | accept 7 300            |
| h35-s5-babble  | wrong_accept        | none         | accept 7 300            |
| h40-s10-room   | wrong_accept        | none         | accept 7 20000          |
| h40-s20-room   | wrong_accept        | none         | accept 7 20000          |
| h40-s5-room    | wrong_accept        | none         | accept 7 20000          |

## Per utterance

| id             | category | expected      | actual                    | confidence | latency ms |
| -------------- | -------- | ------------- | ------------------------- | ---------- | ---------- |
| h01-s10-babble | snr10    | bid 4 40000   | accept 4 40000            | 1.000      | 406        |
| h01-s20-babble | snr20    | bid 4 40000   | accept 4 40000            | 1.000      | 403        |
| h01-s5-babble  | snr5     | bid 4 40000   | none                      | 0.500      | 201        |
| h02-s10-room   | snr10    | bid 5 60000   | accept 5 60000            | 1.000      | 223        |
| h02-s20-room   | snr20    | bid 5 60000   | accept 5 60000            | 1.000      | 245        |
| h02-s5-room    | snr5     | bid 5 60000   | accept 5 60000            | 1.000      | 226        |
| h03-s10-babble | snr10    | bid 3 65000   | accept 3 65000            | 1.000      | 288        |
| h03-s20-babble | snr20    | bid 3 65000   | accept 3 65000            | 1.000      | 198        |
| h03-s5-babble  | snr5     | bid 3 65000   | accept 3 65000            | 1.000      | 231        |
| h04-s10-room   | snr10    | bid 4 87500   | accept 4 87500            | 1.000      | 221        |
| h04-s20-room   | snr20    | bid 4 87500   | accept 4 87500            | 1.000      | 204        |
| h04-s5-room    | snr5     | bid 4 87500   | accept 4 87500            | 1.000      | 254        |
| h05-s10-babble | snr10    | bid 6 130000  | accept 6 130000           | 1.000      | 228        |
| h05-s20-babble | snr20    | bid 6 130000  | accept 6 130000           | 1.000      | 257        |
| h05-s5-babble  | snr5     | bid 6 130000  | accept 6 100300           | 1.000      | 251        |
| h06-s10-room   | snr10    | bid 8 32500   | accept 8 32500            | 1.000      | 194        |
| h06-s20-room   | snr20    | bid 8 32500   | accept 8 32500            | 1.000      | 205        |
| h06-s5-room    | snr5     | bid 8 32500   | accept 8 32500            | 1.000      | 242        |
| h07-s10-babble | snr10    | bid 5 90000   | accept 5 90000            | 1.000      | 191        |
| h07-s20-babble | snr20    | bid 5 90000   | accept 5 90000            | 1.000      | 217        |
| h07-s5-babble  | snr5     | bid 5 90000   | none                      | 0.500      | 313        |
| h08-s10-room   | snr10    | bid 6 75000   | accept 6 75000            | 1.000      | 253        |
| h08-s20-room   | snr20    | bid 6 75000   | accept 6 75000            | 1.000      | 257        |
| h08-s5-room    | snr5     | bid 6 75000   | accept 6 75000            | 1.000      | 224        |
| h09-s10-babble | snr10    | bid 4 42500   | accept 4 42500            | 1.000      | 226        |
| h09-s20-babble | snr20    | bid 4 42500   | accept 4 42500            | 1.000      | 316        |
| h09-s5-babble  | snr5     | bid 4 42500   | accept 4 42500            | 1.000      | 256        |
| h10-s10-room   | snr10    | bid 8 67500   | accept 8 67500            | 1.000      | 234        |
| h10-s20-room   | snr20    | bid 8 67500   | accept 8 67500            | 1.000      | 352        |
| h10-s5-room    | snr5     | bid 8 67500   | accept 8 67500            | 1.000      | 407        |
| h11-s10-babble | snr10    | bid 3 110000  | accept 3 110000           | 1.000      | 289        |
| h11-s20-babble | snr20    | bid 3 110000  | accept 3 110000           | 1.000      | 228        |
| h11-s5-babble  | snr5     | bid 3 110000  | none                      | 0.500      | 344        |
| h12-s10-room   | snr10    | bid 5 145000  | accept 5 145000           | 1.000      | 265        |
| h12-s20-room   | snr20    | bid 5 145000  | accept 5 145000           | 1.000      | 252        |
| h12-s5-room    | snr5     | bid 5 145000  | accept 5 145000           | 1.000      | 239        |
| h13-s10-babble | snr10    | bid 6 82500   | confirm 6 825 / 6 82500   | 0.500      | 226        |
| h13-s20-babble | snr20    | bid 6 82500   | accept 6 82500            | 1.000      | 333        |
| h13-s5-babble  | snr5     | bid 6 82500   | confirm 6 825 / 6 82500   | 0.500      | 229        |
| h14-s10-room   | snr10    | bid 4 95000   | accept 4 95000            | 1.000      | 267        |
| h14-s20-room   | snr20    | bid 4 95000   | accept 4 95000            | 1.000      | 350        |
| h14-s5-room    | snr5     | bid 4 95000   | accept 4 95000            | 1.000      | 277        |
| h15-s10-babble | snr10    | bid 8 170000  | accept 8 170000           | 1.000      | 255        |
| h15-s20-babble | snr20    | bid 8 170000  | accept 8 170000           | 1.000      | 357        |
| h15-s5-babble  | snr5     | bid 8 170000  | accept 8 170000           | 1.000      | 254        |
| h16-s10-room   | snr10    | bid 11 45000  | accept 11 45000           | 1.000      | 232        |
| h16-s20-room   | snr20    | bid 11 45000  | accept 11 45000           | 1.000      | 311        |
| h16-s5-room    | snr5     | bid 11 45000  | accept 11 45000           | 1.000      | 261        |
| h17-s10-babble | snr10    | bid 6 50000   | accept 6 50000            | 1.000      | 322        |
| h17-s20-babble | snr20    | bid 6 50000   | accept 6 50000            | 1.000      | 240        |
| h17-s5-babble  | snr5     | bid 6 50000   | confirm 6 10000 / 60000   | 0.500      | 272        |
| h18-s10-room   | snr10    | bid 13 60000  | accept 13 60000           | 1.000      | 224        |
| h18-s20-room   | snr20    | bid 13 60000  | accept 13 60000           | 1.000      | 360        |
| h18-s5-room    | snr5     | bid 13 60000  | accept 13 60000           | 1.000      | 239        |
| h19-s10-babble | snr10    | bid 8 75000   | accept 8 75000            | 1.000      | 226        |
| h19-s20-babble | snr20    | bid 8 75000   | accept 8 75000            | 1.000      | 361        |
| h19-s5-babble  | snr5     | bid 8 75000   | confirm 8 750 / 8 75000   | 0.500      | 260        |
| h20-s10-room   | snr10    | bid 15 80000  | accept 15 80000           | 1.000      | 193        |
| h20-s20-room   | snr20    | bid 15 80000  | accept 15 80000           | 1.000      | 346        |
| h20-s5-room    | snr5     | bid 15 80000  | accept 15 80000           | 1.000      | 322        |
| h21-s10-babble | snr10    | bid 3 37500   | accept 3 37500            | 1.000      | 312        |
| h21-s20-babble | snr20    | bid 3 37500   | accept 3 37500            | 1.000      | 242        |
| h21-s5-babble  | snr5     | bid 3 37500   | accept 3 37500            | 1.000      | 308        |
| h22-s10-room   | snr10    | bid 10 100000 | accept 10 100000          | 1.000      | 230        |
| h22-s20-room   | snr20    | bid 10 100000 | accept 10 100000          | 1.000      | 200        |
| h22-s5-room    | snr5     | bid 10 100000 | accept 10 100000          | 1.000      | 239        |
| h23-s10-babble | snr10    | bid 16 20000  | accept 16 20000           | 1.000      | 197        |
| h23-s20-babble | snr20    | bid 16 20000  | accept 16 20000           | 1.000      | 237        |
| h23-s5-babble  | snr5     | bid 16 20000  | none                      | 0.500      | 230        |
| h24-s10-room   | snr10    | bid 4 200000  | accept 4 200000           | 1.000      | 194        |
| h24-s20-room   | snr20    | bid 4 200000  | accept 4 200000           | 1.000      | 218        |
| h24-s5-room    | snr5     | bid 4 200000  | accept 4 200000           | 1.000      | 249        |
| h25-s10-babble | snr10    | bid 5 260000  | accept 5 260000           | 1.000      | 219        |
| h25-s20-babble | snr20    | bid 5 260000  | accept 5 260000           | 1.000      | 221        |
| h25-s5-babble  | snr5     | bid 5 260000  | accept 5 260000           | 1.000      | 183        |
| h26-s10-room   | snr10    | bid 6 350000  | accept 6 350000           | 1.000      | 261        |
| h26-s20-room   | snr20    | bid 6 350000  | accept 6 350000           | 1.000      | 233        |
| h26-s5-room    | snr5     | bid 6 350000  | accept 6 350000           | 1.000      | 221        |
| h27-s10-babble | snr10    | confirm       | confirm 7 45000           | 0.500      | 227        |
| h27-s20-babble | snr20    | confirm       | confirm 7 45000           | 0.500      | 238        |
| h27-s5-babble  | snr5     | confirm       | confirm 7 45000           | 0.500      | 253        |
| h28-s10-room   | snr10    | confirm       | confirm 7 50000           | 0.500      | 246        |
| h28-s20-room   | snr20    | confirm       | confirm 7 50000           | 0.500      | 417        |
| h28-s5-room    | snr5     | confirm       | confirm 7 50000           | 0.500      | 236        |
| h29-s10-babble | snr10    | confirm       | confirm 7 60000 / 7 65000 | 0.500      | 233        |
| h29-s20-babble | snr20    | confirm       | confirm 7 60000 / 7 65000 | 0.500      | 319        |
| h29-s5-babble  | snr5     | confirm       | confirm 7 60000 / 7 65000 | 0.500      | 252        |
| h30-s10-room   | snr10    | confirm       | confirm 4 30000 / 9 32500 | 0.500      | 266        |
| h30-s20-room   | snr20    | confirm       | confirm 4 30000 / 9 32500 | 0.500      | 322        |
| h30-s5-room    | snr5     | confirm       | none                      | 0.500      | 471        |
| h31-s10-babble | snr10    | confirm       | confirm 7 70000           | 0.500      | 258        |
| h31-s20-babble | snr20    | confirm       | confirm 7 70000           | 0.500      | 258        |
| h31-s5-babble  | snr5     | confirm       | confirm 7 70000           | 0.500      | 263        |
| h32-s10-room   | snr10    | confirm       | confirm                   | 0.500      | 255        |
| h32-s20-room   | snr20    | confirm       | confirm                   | 0.500      | 266        |
| h32-s5-room    | snr5     | confirm       | confirm                   | 0.500      | 235        |
| h33-s10-babble | snr10    | none          | none                      | 0.500      | 225        |
| h33-s20-babble | snr20    | none          | none                      | 0.500      | 326        |
| h33-s5-babble  | snr5     | none          | none                      | 0.500      | 255        |
| h34-s10-room   | snr10    | none          | none                      | 0.500      | 341        |
| h34-s20-room   | snr20    | none          | none                      | 0.500      | 244        |
| h34-s5-room    | snr5     | none          | none                      | 0.500      | 265        |
| h35-s10-babble | snr10    | none          | accept 7 300              | 1.000      | 335        |
| h35-s20-babble | snr20    | none          | accept 7 300              | 1.000      | 359        |
| h35-s5-babble  | snr5     | none          | accept 7 300              | 1.000      | 253        |
| h36-s10-room   | snr10    | none          | none                      | 0.500      | 257        |
| h36-s20-room   | snr20    | none          | none                      | 0.500      | 365        |
| h36-s5-room    | snr5     | none          | none                      | 0.500      | 355        |
| h37-s10-babble | snr10    | none          | none                      | 0.500      | 200        |
| h37-s20-babble | snr20    | none          | none                      | 0.500      | 229        |
| h37-s5-babble  | snr5     | none          | none                      | 0.500      | 224        |
| h38-s10-room   | snr10    | none          | none                      | 0.500      | 238        |
| h38-s20-room   | snr20    | none          | none                      | 0.500      | 250        |
| h38-s5-room    | snr5     | none          | none                      | 0.500      | 339        |
| h39-s10-babble | snr10    | none          | none                      | 0.500      | 224        |
| h39-s20-babble | snr20    | none          | none                      | 0.500      | 200        |
| h39-s5-babble  | snr5     | none          | none                      | 0.500      | 242        |
| h40-s10-room   | snr10    | none          | accept 7 20000            | 1.000      | 257        |
| h40-s20-room   | snr20    | none          | accept 7 20000            | 1.000      | 260        |
| h40-s5-room    | snr5     | none          | accept 7 20000            | 1.000      | 259        |
