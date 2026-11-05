# Voice data handling

This is a sandbox demo, do not speak personal data.

## What is stored

One audit record per decision. Keys are exactly those of `auditRecordSchema`;
anything else is rejected on write.

| Key         | Description                                            | Retention          |
| ----------- | ------------------------------------------------------ | ------------------ |
| decision    | accept, confirm or drop                                | Audit trail period |
| outcome     | accepted, pending_confirm or rejected                  | Audit trail period |
| transcript  | Final transcript of a decided bid segment              | Audit trail period |
| bidderId    | Bidder id of an accepted or confirmed bid              | Audit trail period |
| amountCents | Parsed bid amount                                      | Audit trail period |
| confidence  | Combined confidence score                              | Audit trail period |
| confirmed   | Whether the bidder confirmed a prompt                  | Audit trail period |
| reason      | Decision reason code                                   | Audit trail period |
| evidence    | Segment id, audio window, provider name, parse results | Audit trail period |

## What is NOT stored

- Raw audio bytes
- Voice biometrics. An accepted or confirmed bid does carry the bidder id.
- The words of a drop that read no bid (questions, filler, chatter): the
  transcript is blanked and only the reason and scores are kept. A drop of a
  real bid attempt (for example below the minimum) keeps its transcript.
- Device or browser fingerprints

## Vendor retention

Vendor retention terms for Groq and Deepgram (speech to text), the browser
speech service used by `WebSpeechStt` (Google in Chrome, run by the browser,
not by this code) and the language model vendor are UNVERIFIED (gate G5).
Audio is streamed to the speech vendor for real-time transcription and is not
stored on our side. Deepgram is first in the default provider order and the
G5 harness sends it audio. With Web Speech the browser vendor receives the
audio even though this code uploads none. If a language model is configured,
the transcript, the previous segment and the registered paddles are sent to
its vendor to help read a bid; that path is not wired into the pipeline yet. Until vendor terms are verified, this system is for
sandbox use only.
