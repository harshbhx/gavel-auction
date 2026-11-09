# G5 held-out noisy set: result, measured once

Pre-registration: [HELDOUT-NOISY-PREREG.md](HELDOUT-NOISY-PREREG.md). Run: https://github.com/harshbhx/gavel-auction/actions/runs/42567832671 (workflow `voice-heldout`, confirmation text `MEASURE-ONCE`, 9 Nov 2026 05:31 UTC, commit 0085f1480673ea899cf80fd0a75f5aad31d975d1 as named in the reports).

## Plain statement

Measured once on a synthetic held-out set (eSpeak speech, simulated room and babble noise, 120 clips = 40 utterances x SNR 20, 10 and 5 dB, one request per clip and provider). The pre-registered thresholds were not met by either provider. The result is worse than the in-sample result on the 24 noise-free clips (wrong accept 0.000 there). G5 stays PARTIAL.

## Thresholds (from the pre-registration)

Per provider, on all 120 clips: wrong accept 0.05 or less, and exact plus recoverable 0.90 or more. Per SNR cell (n = 40): wrong accept 0.05 or less.

## Result per provider (from report.json)

| Measure                       | Groq whisper-large-v3-turbo | Deepgram nova-3           | Line         |
| ----------------------------- | --------------------------- | ------------------------- | ------------ |
| exact (of 78 bids)            | 0.8846                      | 0.7436                    | no line      |
| recoverable (of 78 bids)      | 0.0385                      | 0.0000                    | no line      |
| exact plus recoverable        | 0.9231 (met)                | 0.7436 (missed)           | 0.90 or more |
| wrong accept (of 120 clips)   | 0.0583 (7 clips, missed)    | 0.0917 (11 clips, missed) | 0.05 or less |
| missed bid (of 78 bids)       | 0.0513 (4)                  | 0.0513 (4)                | no line      |
| confirm rate (of 120 clips)   | 0.175 (21 clips)            | 0.2333 (28 clips)         | no line      |
| false prompt (of 24 non-bids) | 0.000                       | 0.0417                    | no line      |
| number token error rate       | 0.1917                      | 0.1083                    | no line      |

## Wrong accept per SNR cell (n = 40 each)

| SNR   | Groq              | Deepgram          | Line         |
| ----- | ----------------- | ----------------- | ------------ |
| 20 dB | 0.050 (2), met    | 0.075 (3), missed | 0.05 or less |
| 10 dB | 0.050 (2), met    | 0.100 (4), missed | 0.05 or less |
| 5 dB  | 0.075 (3), missed | 0.100 (4), missed | 0.05 or less |

Exact rate per SNR, Groq: 1.000 at 20 dB, 0.962 at 10 dB, 0.692 at 5 dB. Overall outcome: Groq met the exact-plus-recoverable line and missed the overall wrong-accept line and the 5 dB cell; Deepgram missed every line.

## What the numbers mean

- The eval's definition: a wrong accept is a clip where the parser answered `accept` (a bid taken without a confirm prompt) and the accepted pair is not the spoken bid, counted over all 120 clips; an accepted non-bid counts (`isWrongAccept` in `packages/voice/src/eval/metrics.ts`). A confirm answer is not an accept.
- The parser asked for a confirm on 21 of 120 clips (Groq, 0.175) and 28 of 120 clips (Deepgram, 0.2333). The confirm step is what keeps a doubtful reading from becoming a bid, but the wrong accepts above are readings the parser accepted without it.
- Room pipeline (microphone rule `room`): the reports show 0 auto-accepted bids for both providers (Groq: 90 confirm and 30 drop; Deepgram: 85 confirm and 35 drop; by construction on the room microphone; the speech-to-text confidence was not recorded and a neutral value was assumed for all 120 clips). So no wrong accept reaches the auction without a prompt in the product on the room microphone, but that is by construction, not a measured property of the speech recognition.
- The threshold sweep is flat from 0.70 to 0.95 for both providers (the parser emits only 0.50, 0.95 and 1.00), so changing the AUTO threshold would not change these counts.
- The audio is synthetic and robotic and the noise is simulated; no person was recorded and no real room was used. 120 clips from 40 utterances move a rate by 0.0083 per clip for the overall rates and 0.025 per clip in a cell.

## No tuning on this set

Nothing was changed in the parser, options, thresholds, labels or clips after seeing this result, and the set is not measured a second time to improve a number. Any later change to the parser, the provider options or the thresholds that is made after reading these failures counts as in-sample for this set.

## Files

Committed under `docs/evidence/G5/heldout/` (the 120 wav files are not committed; their sha256 list is `SHA256SUMS`). `report.json` and `report.md` were re-laid out by prettier; the numbers are those of the artifact `voice-heldout`.

| File                   | sha256                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| `groq/report.json`     | bb91ce54b78a7bc4fa4f15b04098f77ff449afb47beb1086f1e9b38c841148eb |
| `groq/report.md`       | 68cfa46526bada21a590186fd93166f5a398bf9afbeed79820aad1b0f182b26a |
| `deepgram/report.json` | 5ed4dd9df8e1ce61f03ee9df1cf1f4d7eb541488ac8bdbe0a39ad0cafeb7fccd |
| `deepgram/report.md`   | 25561997933c9568d532f2455684f009754df81bef6ef91a17d96d38878bef91 |
| `SHA256SUMS` (120 wav) | b5c11966f0792cdb185830643068fdecffeaf7b9c49e27cfc1f67a16b7c2f13f |

The cached replay of the recorded provider output in the same run gave identical metrics.
