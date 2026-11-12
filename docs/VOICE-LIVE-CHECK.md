# Live speech through the /audio socket: what the check needs

Status: run once on synthetic clips. Issue #2194 stays open. The speech path is scored from cached
provider transcripts (`packages/voice/fixtures/README.md`), and one live run through the `/audio`
socket is recorded: run 42575018866 (9 Nov 2026), 24 synthetic clips, fake PayPal, a local server,
no human voice (`docs/evidence/voice-live-socket/README.md`). This page says what such a run needs
and whether Actions can do it without a person speaking. A run with a person speaking is not
recorded.

## What the socket expects

Read from `packages/server/src/host/audio-ws.ts` and `packages/voice/src/audio/frame.ts`:

1. Upgrade `GET /audio?auction=<id>` with an `Origin` header that is in the server's allowed origins
   (otherwise 403).
2. The opening message, within 5 seconds: the text frame `{"t":"auth","token":"<auctioneer token>"}`. The
   token must be the room's auctioneer token; other kinds are refused (close code 4401).
3. Wait for the server's `{"t":"ready"}`. Audio sent before it is refused.
4. Binary frames only afterwards: a 12 byte header (magic `0x56`, version 1, flags) and up to ten
   frames of 320 samples (640 bytes, 16 kHz mono signed 16 bit little-endian), at most 8 KiB per
   message. The client sets the end-of-stream flag when done.
5. The server answers with JSON text frames: decisions (confirm prompts or drops) plus `status`,
   `caption` and `confirm_expired` (`packages/server/src/voice/bridge.ts`).

## What a run needs

| Need          | Detail                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio fixture | The 24 synthetic clips in `packages/voice/fixtures/audio/recordings/*.wav` (eSpeak, 16 kHz mono) or the human-like set in `audio-human/*.mp3` (decode to 16 kHz mono PCM first). Both are synthetic, so the run proves the path, not room accuracy. |
| Provider key  | `VOICE_STT=groq` with `GROQ_API_KEY`, or `VOICE_STT=deepgram` with `DEEPGRAM_API_KEY`. The `voice-eval` workflow already reads both from repository secrets; they must never be printed.                                                            |
| Server        | A server started in the job with the fake payments adapter, a known `ADMIN_KEY`, `TOKEN_SECRET` and an allowed origin matching the client's `Origin`; no real room or sandbox money is needed.                                                      |
| Room          | One auction created through the API, a bidder registered with a paddle, and the auctioneer token from the create response. Clips name paddles and amounts the room must know.                                                                       |
| Client        | A small Node script using `ws` that sends the auth frame, waits for `ready`, encodes each clip with `encodeBatch` from `@gavel/voice`, paces frames at real time (20 ms per frame), sends end-of-stream and records the frames it receives.         |
| Assertions    | Per clip: the decision kind and the latency. Across clips: no bid is placed without a confirm on the room microphone. The server must report the live provider, not the cached fallback (see below).                                                |

## Steps

1. Start the server with `VOICE_STT` and the key set from secrets.
2. Create a room and register a bidder; keep the auctioneer token in memory only.
3. For each clip: open the socket, auth, wait for `ready`, stream, close; collect the decisions.
4. Write a JSON report (provider, number of clips, per-clip decision kind and milliseconds) as a
   workflow artifact. Commit it only after a person reads it.

## Can it run in Actions without a human voice?

Yes for the server path. The clips are files, the socket takes PCM frames from any client, and the
`voice-eval` workflow already holds the provider secrets and runs on `ubuntu-latest`. It does not need
a microphone, a browser or a person. Two cautions:

- The provider chain falls back to the cached provider when the live one fails (`voice/stt.ts`, the
  failover chain ends at the cached provider). A green run could therefore be a cached run. The job
  must assert that the live provider answered, for example from the `status` frame, the server log of
  the provider in use, or by checking the report's latency against cache values, and fail otherwise.
- A job with secrets does not run on pull requests from forks, and the run costs provider usage, so it
  belongs behind `workflow_dispatch` like the live mode of `voice-eval`.

What it cannot show: real speech in a room with noise, accents and a real microphone, and the web
console microphone (FEAT-62) has been tested only with a fake microphone and socket (`docs/DEMO.md`). A person with a microphone is still needed for
that, and the wording of the voice claims should say "synthetic clips through the server socket".
