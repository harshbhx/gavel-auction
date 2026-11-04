# Voice contracts: note for shared and server

Status: proposal for agreement with the realtime owner. Source: voice spec section 14, requests 1
and 2. Nothing here is implemented by this note; shared and server own the changes.

## 1. Voice evidence on the bid message

Request: the `bid` message in shared/realtime SHOULD carry two optional fields.

| field       | type            | meaning                                                         |
| ----------- | --------------- | --------------------------------------------------------------- |
| `voice`     | `VoiceEvidence` | why the voice pipeline produced this bid; absent for other bids |
| `confirmed` | `boolean`       | true when a person confirmed a prompt before the bid was sent   |

Both fields are optional, so existing senders and receivers keep working unchanged.

### The `evidence` payload (`VoiceEvidence`)

Fields are defined in the voice spec, section 5, and are stored verbatim:

| field            | type                  | notes                                                          |
| ---------------- | --------------------- | -------------------------------------------------------------- |
| `segmentId`      | string                | id of the speech segment                                       |
| `idempotencyKey` | string                | `roomId:lotId:audioStartMs:sha1(text)[0..12]`; dedupes retries |
| `transcript`     | string                | decided text; personal data, see retention below               |
| `audioStartMs`   | number                | segment start, ms from stream start                            |
| `audioEndMs`     | number                | segment end, ms from stream start                              |
| `sttProvider`    | string                | provider name only                                             |
| `sttConfidence`  | number                | 0 to 1                                                         |
| `replay`         | boolean               | true for recorded audio                                        |
| `rules`          | `ParseResult`         | rule parser result                                             |
| `llm`            | `ParseResult` or null | language-model parser result, null when unavailable            |
| `confidence`     | number                | final confidence, 0 to 1                                       |
| `reason`         | `VoiceReason`         | why the pipeline decided as it did                             |

Server behaviour requested:

- `audit_event` stores `voice` verbatim; the server does not edit or interpret it.
- The engine stays authoritative on ceilings, increments and acceptance. `voice` is evidence, never
  an instruction, and a bid carrying it is validated like any other bid.
- A repeated `idempotencyKey` for the same room and lot is treated as a retry of the same bid.
- Until the field is merged, the voice session posts the same evidence as an `audit_event`.
- No audio is ever part of the evidence or of the audit record.

## 2. Audio path

Request: a binary WebSocket path `/audio`. The server owns the route; voice owns the codec.

- Every message is one binary batch: 12 byte header followed by 1 to 10 whole frames of 640 bytes
  (20 ms, 16 kHz, mono, Int16 little endian). Header layout (voice spec section 5):
  byte 0 `0x56`, byte 1 version 1, byte 2 flags (bit0 discontinuity, bit1 keepalive with no payload,
  bit2 end of stream), byte 3 reserved 0, bytes 4 to 7 `seq` (u32), bytes 8 to 11 `tsMs` (u32).
- The same session token as `join` is required. Text frames are rejected.
- Limits: 64 KiB/s per stream, 30 minutes per session, one stream per (room, source).
- A violation closes the stream with a typed error code from the list below.

## 3. Error codes

To be added in shared, next to the existing realtime codes:

| code                  | raised when                                                                     | stream after |
| --------------------- | ------------------------------------------------------------------------------- | ------------ |
| `AUDIO_BAD_FRAME`     | wrong magic, unknown version, payload not 1 to 10 whole frames, or a text frame | closed       |
| `AUDIO_RATE_LIMIT`    | more than 64 KiB/s on one stream                                                | closed       |
| `AUDIO_SESSION_LIMIT` | session over 30 minutes, or a second stream for the same (room, source)         | closed       |

Voice maps its frame errors (`bad_magic`, `bad_version`, `bad_length`) to `AUDIO_BAD_FRAME`.

## 4. Open points for the realtime owner

- Agree the field names `voice` and `confirmed`, or propose alternatives, before shared changes.
- Confirm that `audit_event` retention follows the voice data rules: transcript text of decided
  segments and parse results only, no audio.
- Confirm the close code mapping from the three error codes to WebSocket close frames.
