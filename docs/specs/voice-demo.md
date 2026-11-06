# Voice demo script (20 seconds)

Sandbox demo, do not speak personal data. Vendor retention terms for the speech providers are unverified (gate G5).

## Setup

- Room microphone with paddle numbers for the video; phone microphone with speaker attribution for the try-it page.
- Whole-dollar bids in the demo auction; cents are parsed but confirmed.
- The on-screen label says "Live" or "Recorded" and must match the source.

## Script

| Time   | Say                                | Expected on screen                                                          |
| ------ | ---------------------------------- | --------------------------------------------------------------------------- |
| 0-8 s  | "paddle twelve, three fifty"       | Caption appears, parse highlights paddle 12 and $350, bid accepted          |
| 8-20 s | "two fifty, no wait three hundred" | Confirm prompt "Change paddle 7 from $250 to $300?"; tap yes; bid is placed |

## Fallback steps

1. Speech-to-text fails or the network is down: switch to replay mode with the cached recording. Label: "Recorded audio replay". Captions still play if the audio file cannot load.
2. Voice is unusable and replay is not wanted: use manual entry on the console, or QR bidding from a phone. Both are always available.
3. Say out loud which mode is on screen; never present a recording as live.

Runbook for provider outages: `packages/voice/README.md`.

## Rehearsal plan and notes (issue 490)

Status: cached path verified in CI only; hosted live rehearsals NOT DONE (no provider key and no hosted build available to the author). Fill the table during each rehearsal.

Cached path in CI: `packages/voice/test/replay/cache-fixtures.test.ts` replays `fixtures/stt-cache` through the real parser and decision code on a virtual clock, checks each final lands within 300 ms of its recorded offset, and runs twice for identical decisions. Expected outcomes: utterance 1 accept (paddle 4, $300), utterance 2 confirm, utterance 3 drop.

| Run | Mode                 | Source label shown | Utt 1 at (s) | Utt 2 confirm tapped (s) | Fallback used | Notes |
| --- | -------------------- | ------------------ | ------------ | ------------------------ | ------------- | ----- |
| 1   | live                 |                    |              |                          |               |       |
| 2   | live                 |                    |              |                          |               |       |
| 3   | cached (network off) |                    |              |                          |               |       |

Checks per run: the label reads "Live" for microphone audio and "Recorded audio replay" for the cached clip; the recorded run needs no key; switching to manual entry on the console works with voice disabled; the total stays within 20 s of speech.
