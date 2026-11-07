# Voice fixtures

- `stt-cache/<provider>-u<n>.json`: recorded speech-to-text events for utterance `n` of
  `replay/auction-demo.wav`, one file per provider (`deepgram`, `groq`). `atMs` is the offset from the
  start of the clip. Cached replay mode (R-VOX-082) plays these without keys or network.
- `model-cache/<key>.json`: recorded model output, keyed by `sha256(transcript + "\n" + canonical json of
the prompt context)` (R-VOX-060). Replay mode throws `LlmCacheMissError` on a miss; it never calls
  the network.

Provenance: no live provider key was available when these were written, so the events are built from
the reference transcripts of the clip (see `audio/LICENSES.md`) with timings taken from
`replay/timeline.json`, and `source` says `reference-transcript`. They are not captures of a provider
run. When the live run of gate G5 happens, re-record with the record mode of the model client and
replace the files; keep the file names.

## Synthetic audio clips and provider cache (issue 1864)

- `audio/recordings/<id>.wav`: the 24 clips of `audio/manifest.json`, rendered by
  `scripts/render-clips.sh` with eSpeak NG (16 kHz mono, 300 ms of silence either side). Synthetic,
  noise-free speech: the manifest `noise` and `snrDb` fields are not applied, and the voice ids map
  to eSpeak voices and variants, not to the voices named in `audio/LICENSES.md`.
- `stt-cache/<provider>/<id>.json`: what Deepgram (`nova-3`, `punctuate=true`, `smart_format=false`)
  and Groq (`whisper-large-v3-turbo` with the bid-words prompt, temperature 0) returned for each clip
  (`text`, `latencyMs`), recorded by the option-trials job of the `voice-eval` workflow (variants
  `dg-nova3-punct` and `gq-turbo-prompt-b`, runs 42365428369 for both). They replace the first
  recordings (Deepgram `nova-2`, Groq without a prompt), which are in the git history and whose
  scores are in docs/GATES.md. No key or request header is stored. Cached mode scores these.
- This is a loop check, not a real-room test. Scores here must not be quoted as room accuracy.
- `audio-human/<id>.mp3` and `stt-cache-human/<provider>/<id>.json`: the second clip set, the same 24
  utterances spoken by a human-like synthetic voice (see `audio/LICENSES.md`), and what the two
  providers returned for it (Deepgram nova-3 and Groq with the bid-words prompt, from the option
  trials of the `voice-eval` workflow; the nova-2 recordings of the first run are in the git history).
  The cached job scores it with `--clips human`. Also noise-free and synthetic, so also not a real-room test.
