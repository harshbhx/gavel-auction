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

`packages/server` depends on this package and mounts the `/audio` WebSocket (`src/host/audio-ws.ts`). The upgrade URL carries `auction` and an optional `source`, never a token; the first message must be the text frame `{"t":"auth","token":...}` (the auctioneer token the room join uses) within 5 seconds, otherwise the socket closes with 4401, as it does for audio sent before auth. The server answers `{"t":"ready"}` once the stream is open; the client streams after that. `createVoiceSession` enforces the stream limits, a `VoicePipeline` runs per stream, and each decision reaches the room through `Room.submitVoiceBid`, so a confident bid takes the room's confidence gate and a low confidence or ambiguous one is held and put to its bidder as a confirm request; the engine judges every bid that passes. `toPlaceBid` supplies the message id, so a replayed utterance maps to the same id. The vendor key scan (`npm run scan:secrets -w @gavel/voice`) runs in the `ci.yml` voice job.

The speech provider comes from `VOICE_STT`. Unset or `replay` plays cached transcripts and needs no key. `groq` with `GROQ_API_KEY` runs Groq behind `FailoverStt` with the cached provider as fallback; a named provider without its key is logged and the cached provider is used, so a missing key never stops the host. `ReplaySource` (WAV to batches) stays in the replay mode and the evaluation CLI.

## Providers

Selectable providers: `groq`, `fake`.

`selectProvider` builds only those. `deepgram` and `webspeech` are accepted names. Their clients exist in this package (`src/stt/deepgram.ts`, `deepgram-reconnect.ts`, `webspeech.ts`) but are built and not selectable, because `selectProvider` has no builder for them: a `DEEPGRAM_API_KEY` alone fails startup with `none_configured`, and with both keys set Groq is used alone and a warning is logged. `replay` is not selected by name; the replay mode constructs `ReplayStt` directly. `selectProvider` itself does not wrap anything in `FailoverStt`; the server does, around the live provider.

## Live evaluation against the real providers

`npm run eval -w @gavel/voice -- --mode live --provider <deepgram|groq> --out eval-out/live` sends each evaluation clip to the provider's prerecorded endpoint (`src/eval/live.ts`, also exported as `transcribeLive`) and scores the transcript through the parser. The same adapters back `npm run gate:g5 -w @gavel/e2e`. Cached and text modes are unchanged and need no key.

- Recordings: one `<id>.wav` per clip listed in `fixtures/audio/manifest.json`, in the directory named by `G5_AUDIO_DIR` (default `packages/voice/fixtures/audio/recordings`). The recordings are not in the repository and must not be committed.
- Missing recordings: if any are absent the run prints `eval: skipped: N of M recordings missing` and exits 0 without a report.
- Consent: record only people who agreed to have their voice sent to the speech vendors for this evaluation, and no personal data.
- Keys: `DEEPGRAM_API_KEY` or `GROQ_API_KEY`, supplied only through repository secrets or the shell environment. Without the key the run exits 2 and names the missing variable. Key values are never printed or written to reports.
- Failures: HTTP 429 and 5xx answers and network errors are retried up to 3 attempts in total with a doubling delay; other statuses fail at once with the provider name and status.

## Run the tests

```
npm test -w @gavel/voice
npm run typecheck -w @gavel/voice
```

No test calls the network; the fake provider supplies transcripts. Heavy runs happen in CI.

## Outage runbook

Check in this order while the room is live.

1. Speech provider silent or erroring. With a live provider the server fails over to the cached one. `FaultTracker` marks speech `degraded` after 8 s and `down` after 15 s and the console shows the manual entry banner. Switch to manual entry (always available) or restart the voice session.
2. Speech down and the language model down. `bidsAllowed` becomes false and the QR bidding banner shows. With speech down and the model up, bids stay allowed. The capture state is independent: `degraded` there only means audio frames are being dropped.
3. Microphone denied, missing or on an insecure page. The state names the cause; there is no retry loop. Fix the browser permission or use manual entry.
4. Wrong bid heard. Ambiguous amounts ask for confirmation before any bid is placed; reject the prompt and type the bid.
5. Network down at the venue. Switch the demo to replay mode (below); it needs no provider.

Secrets: `GROQ_API_KEY` and `LLM_API_KEY` (names in `.env.example`). Never print them or commit them.

## Demo script and fallback

The 20 second demo script and its fallback steps are in `docs/specs/voice-demo.md`.
