# G5 held-out noisy clip set: pre-registration

Issue: #2192. This file is committed before any clip of the set is rendered and before any provider has heard it. The thresholds below are fixed here and are not changed after the measurement. The set is measured once.

## What this is, and what it is not

- The audio is synthetic. The speech is eSpeak NG (robotic, the same engine as the first 24-clip set). The noise is simulated: a generated room bed and a generated babble bed mixed in by the existing `packages/voice/scripts/mix-noise.sh`. No person was recorded and no real room was used.
- The human-like voice used for the second 24-clip set (ElevenLabs) needs a key that is not a repository secret, so it is not used here. The set therefore tests noise robustness of the frozen pipeline on robotic speech, not a human voice in a room.
- G5 stays PARTIAL whatever the number is. This file and the results file may say "held-out noisy synthetic set passed" or "did not pass". Moving the gate to PASS is an explicit decision of the owner, and `docs/GATES.md` is not edited by this work.

## The set

- 40 new utterances in `packages/voice/fixtures/audio-heldout/utterances.json` (sha256 of the file at the time of writing: `d6aaa1c91f225bd44b0b03c74f355aa3e00369a4bafe50a059c125d81d901c64`). None of the 40 texts appears in the 175 text cases (`fixtures/text/cases.json`) or in the 24 clips (`fixtures/audio/manifest.json`); the overlap check ran on normalised lower-case text and found none after five texts were reworded before building anything else.
- Mix: 26 bids (9 plain, 8 colloquial, 8 with a paddle named aloud, 1 numeral), 6 confirm cases (correction, hedged, two bidders, make-it, currency), 8 non-bids. Labels are written from the intended meaning of each sentence, not from any parser output, and are final.
- Each utterance is rendered at three nominal SNRs: 20, 10 and 5 dB. That gives 120 clips, n = 40 per SNR. The noise kind alternates by utterance: even utterance numbers get room noise, odd ones get babble, so each SNR has 20 clips of each kind.
- Nominal SNR is the existing `mix-noise.sh` definition: RMS of the whole clean clip (300 ms padding included) against RMS of the noise bed. It is a nominal figure, not a speech-active measurement.
- Seeds are fixed in the generated manifest. The beds are generated, not downloaded.

## Frozen pipeline

Not changed by this work and checked by the workflow against the commit named in the workflow input `frozen_sha`:

- the rule parser (`packages/voice/src/parser`), the room gate (`src/eval/gate.ts`), the metrics (`src/eval/metrics.ts`), the decision config (`src/decide`), the provider adapters and request defaults (`src/stt`, `src/eval/live.ts`).
- Deepgram: nova-3, `punctuate=true`, `smart_format=false` (the room defaults). Groq: whisper-large-v3-turbo with the bid-words prompt and temperature 0 (`G5_GROQ_TEMPERATURE=0`, the option chosen in the VOI-02 trials).
- Each clip is sent once to each provider. A rate-limit retry only asks again for clips that have no recorded answer; a clip that has an answer is never re-sent, so no clip is re-rolled.

## Thresholds, fixed now

Per provider, on all 120 clips, with the repository's own G5 criteria (`gateG5` in the eval, the same ones that GATES.md quotes):

1. wrong accept 0.05 or less (wrong accept is counted over all clips: an accepted bid that is not the spoken bid, including an accepted non-bid).
2. exact plus recoverable 0.90 or more.

Per SNR cell (n = 40 per provider and SNR), the wrong accept rate must also be 0.05 or less. One wrong accept in a cell is 0.025, two is 0.050, three is 0.075.

Exact rate, confirm rate and the confusion list are reported per SNR and per provider with no pass line. The 5 dB cell is a stress cell: it is reported and its wrong accept line applies, but a low exact rate there is not a failure of its own.

"Held-out noisy synthetic set passed" may be written for a provider only if both overall criteria and all three per-SNR wrong accept lines hold. If any line fails, the number is reported as it is. No parser rule, option, threshold, label or clip is changed after seeing a result, and the same set is not measured a second time to improve a number.

Room gate (microphone rule `room`): auto-accepted bids are reported next to the above. On the room microphone this is 0 by construction.

## How the measurement runs

The workflow `voice-heldout` (dispatch only, `.github/workflows/voice-heldout.yml`) renders the clips, runs the guard on the frozen files, runs the live eval for both providers, and uploads the reports, the recorded provider output and a `SHA256SUMS` file of the clips as one artifact. It needs the repository secrets `DEEPGRAM_API_KEY` and `GROQ_API_KEY`; both are present in the repository. It must be dispatched with the confirmation text `MEASURE-ONCE`. The results are written by hand from that artifact into `docs/evidence/G5/HELDOUT-NOISY.md`, with the run URL, per-SNR counts and the clip sha256 list, and the recorded provider output may be committed under `packages/voice/fixtures/stt-cache-heldout` so the cached mode can replay it.
