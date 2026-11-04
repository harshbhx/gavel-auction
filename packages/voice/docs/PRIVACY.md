# Voice data handling

This is a sandbox demo, do not speak personal data.

## What is stored

| Key            | Description                         | Retention          |
| -------------- | ----------------------------------- | ------------------ |
| transcript     | Final transcript of decided segment | Audit trail period |
| parseResult    | Parsed bid amount and paddle        | Audit trail period |
| confidence     | STT confidence score                | Audit trail period |
| timestampMs    | Server timestamp of the segment     | Audit trail period |
| provider       | STT provider name                   | Audit trail period |
| decision       | Engine decision for the bid         | Audit trail period |
| confirmOutcome | Auctioneer confirm/reject result    | Audit trail period |

## What is NOT stored

- Raw audio bytes
- Speaker identity or voice biometrics
- Any data from non-bid utterances (questions, filler, chatter)
- Device or browser fingerprints

## Vendor retention

Vendor retention terms for Deepgram and Groq are UNVERIFIED (gate G5).
Audio is streamed to the vendor for real-time transcription and is not
stored on our side. Until vendor terms are verified, this system is for
sandbox use only.
