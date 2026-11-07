# Audio fixture licenses and consent

One row per voice or noise id used in `manifest.json` (R-VOX-079). The first column is the id the
fixture tool checks. Source and retrieval details for synthetic voices and noise beds are filled in
by the CI job owner before the first render.

| id           | kind  | source                                     | license                     | consent                            |
| ------------ | ----- | ------------------------------------------ | --------------------------- | ---------------------------------- |
| tts-en-US-1  | voice | open-source synthesis model, en-US speaker | CC0 or equivalent (to cite) | not applicable, synthetic          |
| tts-en-GB-1  | voice | open-source synthesis model, en-GB speaker | CC0 or equivalent (to cite) | not applicable, synthetic          |
| tts-en-IN-1  | voice | open-source synthesis model, en-IN speaker | CC0 or equivalent (to cite) | not applicable, synthetic          |
| team-voice-1 | voice | team recording (issue 433)                 | contributor grant, in repo  | written consent pending, issue 433 |
| team-voice-2 | voice | team recording (issue 433)                 | contributor grant, in repo  | written consent pending, issue 433 |
| cafe         | noise | public-domain cafe ambience                | CC0 or equivalent (to cite) | not applicable                     |
| crowd        | noise | public-domain crowd ambience               | CC0 or equivalent (to cite) | not applicable                     |

## Replay clip (R-VOX-085)

`../replay/auction-demo.wav` is 24 s, 16 kHz mono, about 0.77 MB. Speech is synthetic, rendered
with the two en-US voices of the Windows speech synthesizer (David and Zira). Room noise is seeded
pseudo-random noise generated for the clip. No person was recorded, so no consent is needed.
Lines in timeline order: "Bidder four, three hundred." (bid), "Three fifty or maybe four hundred, I
am not sure." (confirm), "Let me think about that for a moment." (none).

| id           | kind  | source                                   | license                         | consent                   |
| ------------ | ----- | ---------------------------------------- | ------------------------------- | ------------------------- |
| sapi-david   | voice | Windows speech synthesizer, en-US male   | output of an installed OS voice | not applicable, synthetic |
| sapi-zira    | voice | Windows speech synthesizer, en-US female | output of an installed OS voice | not applicable, synthetic |
| generated-rn | noise | seeded noise written for this clip       | generated, no third-party audio | not applicable            |

## Rendered recordings (issue 1864)

`recordings/*.wav` are synthetic, rendered in CI by `scripts/render-clips.sh` with eSpeak NG (GPL-3.0
software; the generated speech is not a copy of third-party audio). All 24 clips use eSpeak voices
(`en-us`, `en-gb`, `en-gb-x-rp+f3`, `en-us+m3`, `en-us+f2`); the voice ids in the manifest select which.
No person was recorded, so no consent is needed. The noise beds above are not mixed in.

## Human-like synthetic clips (audio-human)

`../audio-human/a01.mp3` to `a24.mp3` speak the same 24 utterances as the manifest (clip id equals
manifest id) with one general-purpose English text-to-speech voice (ElevenLabs, voice "Kiora",
model eleven_multilingual_v2), one generation per clip, mono mp3. The speech is synthetic and
noise-free; the manifest noise field is not applied. Generated under the account's service terms; no
person was recorded, so no consent is needed. The workflow converts them to 16 kHz mono wav before
the live run.
