# @gavel/voice

Audio capture and framing, speech-to-text provider clients, the bid parser and the confirm-on-ambiguity pipeline.

**Sandbox demo, do not speak personal data.** Vendor retention terms for Deepgram and Groq are unverified (gate G5 in `docs/GATES.md`). Audio is streamed to the vendor for real-time transcription and is not stored on our side. See `docs/PRIVACY.md` for what is kept. This notice stays until the vendor terms are verified.

## What is here

- `src/audio`: framing (20 ms frames, 100 ms batches), resampling, endpointing, recorder.
- `src/stt`: provider interface with Deepgram, Groq, fake and replay providers and latency counters.
- `src/parser`, `src/decide`, `src/pipeline`: spoken amount to a structured bid, with a confirm prompt when the amount is ambiguous.
- `src/session.ts`: one session per room and lot.
- `fixtures`: audio, text cases and the replay timeline used by tests and the replay mode.

## Run the tests

```
npm test -w @gavel/voice
npm run typecheck -w @gavel/voice
```

No test calls the network; the fake provider supplies transcripts. Heavy runs happen in CI.

## Outage runbook

Check in this order while the room is live.

1. Provider silent or erroring. The failover wrapper moves from Deepgram to Groq when there is no event within 3 s of audio start, a non-retryable error, two retryable errors in a row, or a final transcript later than 4 s after speech end. It replays the last 5 s of audio into the fallback and keeps the primary closed for 30 s.
2. Both providers down. The capture state becomes `degraded` or `error` and the console shows its message with a fallback action. Switch to manual entry (always available) or QR bidding.
3. Microphone denied, missing or on an insecure page. The state names the cause; there is no retry loop. Fix the browser permission or use manual entry.
4. Wrong bid heard. Ambiguous amounts ask for confirmation before any bid is placed; reject the prompt and type the bid.
5. Network down at the venue. Switch the demo to replay mode (below); it needs no provider.

Secrets: `DEEPGRAM_API_KEY` and `GROQ_API_KEY` (names in `.env.example`). Never print them or commit them.

## Demo script and fallback

The 20 second demo script and its fallback steps are in `docs/specs/voice-demo.md`.
