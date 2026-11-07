# @gavel/voice

Audio capture and framing, speech-to-text provider clients, the bid parser, the decision step and the fault tracker.

**Sandbox demo, do not speak personal data.** Vendor retention terms for Groq and the language model vendor are unverified (gate G5 in `docs/GATES.md`). Audio is streamed to the speech vendor for real-time transcription and is not stored on our side. See `docs/PRIVACY.md` for what is kept. This notice stays until the vendor terms are verified.

## What is here

- `src/audio`: framing (20 ms frames, 100 ms batches), resampling, endpointing.
- `src/stt`: provider interface, the Groq, Deepgram (`DeepgramStt`, `ReconnectingDeepgramStt`) and Web Speech (`WebSpeechStt`) clients, the fake and replay providers, `FailoverStt`, the push-to-talk `MuteController` (in `src/browser`) and latency counters.
- `src/parser`, `src/decide`, `src/llm`: spoken amount to a structured bid, merge of the rule and model readings, and a confirm prompt when the amount is ambiguous. The model reading is not wired into the running pipeline: `PipelineDeps.llm` is synchronous and `createLlmClient().parse` is async, and there is no mapping from the model output (`negated`, `is_correction`, `currency`) to a parse. Without a model reading every bid scores below the auto threshold and asks for a confirm.
- `src/pipeline`: `pipeline.ts` turns a segment into decisions, `bid-command.ts` maps a decision to an engine PlaceBid, `faults.ts` tracks speech and model health.
- `src/session.ts`: the stream limits of the `/audio` socket (frame codec check, per-second byte and message caps, per-token and per-room stream caps, idle sweep, takeover of a stale stream by the same token). It holds no socket and no timers.
- `fixtures`: audio, text cases and the replay timeline used by tests and the replay mode.

## Server wiring status

`packages/server` depends on this package and mounts the `/audio` WebSocket (`src/host/audio-ws.ts`). The upgrade URL carries `auction` and an optional `source`, never a token; the first message must be the text frame `{"t":"auth","token":...}` (the auctioneer token the room join uses) within 5 seconds, otherwise the socket closes with 4401, as it does for audio sent before auth. The server answers `{"t":"ready"}` once the stream is open; the client streams after that. `createVoiceSession` enforces the stream limits, a `VoicePipeline` runs per stream, and each decision reaches the room through `Room.submitVoiceBid`, so a confident bid takes the room's confidence gate and a low confidence or ambiguous one is held and put to its bidder as a confirm request; the engine judges every bid that passes. `toPlaceBid` supplies the message id, so a replayed utterance maps to the same id. The vendor key scan (`npm run scan:secrets -w @gavel/voice`) runs in the `ci.yml` voice job.

The speech provider comes from `VOICE_STT`. Unset or `replay` plays cached transcripts and needs no key. `groq` with `GROQ_API_KEY` runs Groq behind `FailoverStt` with the cached provider as fallback; a named provider without its key is logged and the cached provider is used, so a missing key never stops the host. `ReplaySource` (WAV to batches) stays in the replay mode and the evaluation CLI.

## Providers

Selectable providers: `deepgram`, `groq`, `fake`.

`selectProvider` (`src/stt/select.ts`) builds Deepgram as `ReconnectingDeepgramStt` when `DEEPGRAM_API_KEY` and a WebSocket factory are both present (the server passes the platform socket), Groq as `GroqStt` when `GROQ_API_KEY` and a fetch function are present, and `fake` for tests. With `VOICE_STT` unset it tries `deepgram` then `groq` in that order and uses the first one that has a key and can be built; a provider with a key that cannot be built (for example Deepgram without a socket) is skipped with a warning and the next one is used. With nothing usable it throws `none_configured`. With `VOICE_STT` set to a name, that provider is used or startup fails: `unknown_provider` for a name outside `deepgram`, `groq`, `webspeech`, `fake`, `replay`; `missing_key` when its key is absent; `unavailable` when it has no builder, which is the case for `webspeech` (a browser client) and `replay`. There is no cross-provider fallback when a name is set.

The server does not use the unset default: `chooseStt` (`packages/server/src/voice/stt.ts`) treats an unset `VOICE_STT` as the cached provider, and wraps a live provider in `FailoverStt` with the cached provider as the fallback. The fallback only takes over when a recording exists to play; with no recorded timeline the live provider is kept running. The replay mode constructs `ReplayStt` directly.

What the evidence covers: the G5 clips are synthetic, noise-free speech (20 clips). Deepgram parsed 11 of 11 with no wrong accepts and Groq 9 of 11. There has been no real-room or noisy-audio test, so these numbers do not support a claim about a live room.

## Live evaluation against the real providers

`npm run eval -w @gavel/voice -- --mode live --provider <deepgram|groq> --out eval-out/live` sends each evaluation clip to the provider's prerecorded endpoint (`src/eval/live.ts`, also exported as `transcribeLive`) and scores the transcript through the parser. The same adapters back `npm run gate:g5 -w @gavel/e2e`. Cached and text modes are unchanged and need no key. Cached mode reads `fixtures/stt-cache/<provider>/<clip id>.json` (`text`, `latencyMs`, optional `confidence`); the flat `deepgram-u*.json` and `groq-u*.json` files next to them are replay timelines, a different format. The cached CI job scores all 24 clips for both providers and fails when a provider directory or a clip is missing.

The committed clips and cache are SYNTHETIC: noise-free speech rendered with eSpeak NG, not a real-room test. The manifest `noise` field is not applied to them. They show that the loop works end to end; they say nothing about accuracy in a loud room, so the G5 gate still needs the real recordings.

- Recordings: one `<id>.wav` per clip listed in `fixtures/audio/manifest.json`, in the directory named by `G5_AUDIO_DIR` (default `packages/voice/fixtures/audio/recordings`). The synthetic recordings are committed (about 1.9 MB). Real recordings of people must not be committed.
- Missing recordings: if any are absent the run prints `eval: NOT RUN: N of M recordings missing, nothing was scored` and exits 3 without a report, so the live job fails rather than passing without scores.
- Re-render and re-record: dispatch the `voice-eval` workflow with `record` ticked. It renders the clips with `scripts/render-clips.sh`, runs both providers with `--record fixtures/stt-cache --resume true` using the repository secrets, and uploads the clips, the cache and the reports as the `voice-stt-record` artifact; copy the files from it into the package and commit.
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

1. Speech provider silent or erroring. With a live provider the server fails over to the cached one. `FaultTracker` marks speech `degraded` after 8 s and `down` after 15 s of loud audio with no transcript; the server forwards these as `{"t":"status",...}` text frames on the auctioneer's `/audio` socket (with `caption` and `confirm_expired` frames), so a client can raise the manual entry banner from them. The web console does not render these frames yet; until it does, watch the speech state in the server log and switch to manual entry yourself. A failover is only made to a cached provider that has a recording to play; with no recording the live provider is kept running. Switch to manual entry (always available) or restart the voice session.
2. Speech down and the language model down. `bidsAllowed` becomes false and the QR bidding banner shows. With speech down and the model up, bids stay allowed. The capture state is independent: `degraded` there only means audio frames are being dropped.
3. Microphone denied, missing or on an insecure page. The state names the cause; there is no retry loop. Fix the browser permission or use manual entry.
4. Wrong bid heard. Ambiguous amounts ask for confirmation before any bid is placed; reject the prompt and type the bid.
5. Network down at the venue. Switch the demo to replay mode (below); it needs no provider.

Secrets: `GROQ_API_KEY` and `LLM_API_KEY` (names in `.env.example`). Never print them or commit them.

## Demo script and fallback

The 20 second demo script and its fallback steps are in `docs/specs/voice-demo.md`.
