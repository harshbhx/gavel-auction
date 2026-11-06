# @gavel/voice

Audio capture and framing, speech-to-text provider clients, the bid parser, the decision step and the fault tracker.

**Sandbox demo, do not speak personal data.** Vendor retention terms for Groq and the language model vendor are unverified (gate G5 in `docs/GATES.md`). Audio is streamed to the speech vendor for real-time transcription and is not stored on our side. See `docs/PRIVACY.md` for what is kept. This notice stays until the vendor terms are verified.

## What is here

- `src/audio`: framing (20 ms frames, 100 ms batches), resampling, endpointing, recorder.
- `src/stt`: provider interface, the Groq, Deepgram (`DeepgramStt`, `ReconnectingDeepgramStt`) and Web Speech (`WebSpeechStt`) clients, the fake and replay providers, `FailoverStt`, the push-to-talk `MuteController` (in `src/browser`) and latency counters.
- `src/parser`, `src/decide`, `src/llm`: spoken amount to a structured bid, merge of the rule and model readings, and a confirm prompt when the amount is ambiguous. The model reading is not wired into the running pipeline: `PipelineDeps.llm` is synchronous and `createLlmClient().parse` is async, and there is no mapping from the model output (`negated`, `is_correction`, `currency`) to a parse. Without a model reading every bid scores below the auto threshold and asks for a confirm.
- `src/pipeline`: `pipeline.ts` turns a segment into decisions, `bid-command.ts` maps a decision to an engine PlaceBid, `faults.ts` tracks speech and model health.
- `src/session.ts`: the stream limits of the `/audio` socket (frame codec check, per-second byte and message caps, per-token and per-room stream caps, idle sweep, takeover of a stale stream by the same token). It holds no socket and no timers.
- `fixtures`: audio, text cases and the replay timeline used by tests and the replay mode.

## Server wiring status

This package is a library. `packages/server` does not depend on it and has no `/audio` route: `VoicePipeline`, `toPlaceBid`, `createVoiceSession`, `selectProvider` and `FailoverStt` are exercised by tests, the replay mode and the evaluation CLI, not by a running room. The server keeps its own confirm handling in `room/room.ts`. Mounting the route is tracked in the issues on the server voice adapter; until then voice bidding in a live room is not available. The vendor key scan (`npm run scan:secrets -w @gavel/voice`) runs in the `ci.yml` voice job.

## Providers

Selectable providers: `groq`, `fake`.

`selectProvider` builds only those. `deepgram` and `webspeech` are accepted names. Their clients exist in this package (`src/stt/deepgram.ts`, `deepgram-reconnect.ts`, `webspeech.ts`) but are built and not selectable, because `selectProvider` has no builder for them: a `DEEPGRAM_API_KEY` alone fails startup with `none_configured`, and with both keys set Groq is used alone and a warning is logged. `replay` is not selected by name; the replay mode constructs `ReplayStt` directly. `FailoverStt` is tested but `selectProvider` does not wrap anything in it, so there is no automatic failover in a running room.

## Run the tests

```
npm test -w @gavel/voice
npm run typecheck -w @gavel/voice
```

No test calls the network; the fake provider supplies transcripts. Heavy runs happen in CI.

## Outage runbook

Check in this order while the room is live.

1. Speech provider silent or erroring. There is no automatic failover. `FaultTracker` marks speech `degraded` after 8 s and `down` after 15 s and the console shows the manual entry banner. Switch to manual entry (always available) or restart the voice session.
2. Speech down and the language model down. `bidsAllowed` becomes false and the QR bidding banner shows. With speech down and the model up, bids stay allowed. The capture state is independent: `degraded` there only means audio frames are being dropped.
3. Microphone denied, missing or on an insecure page. The state names the cause; there is no retry loop. Fix the browser permission or use manual entry.
4. Wrong bid heard. Ambiguous amounts ask for confirmation before any bid is placed; reject the prompt and type the bid.
5. Network down at the venue. Switch the demo to replay mode (below); it needs no provider.

Secrets: `GROQ_API_KEY` and `LLM_API_KEY` (names in `.env.example`). Never print them or commit them.

## Demo script and fallback

The 20 second demo script and its fallback steps are in `docs/specs/voice-demo.md`.
