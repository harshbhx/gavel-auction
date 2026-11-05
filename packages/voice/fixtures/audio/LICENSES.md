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
