# Voice fixtures

- `stt-cache/<provider>-u<n>.json`: recorded speech-to-text events for utterance `n` of
  `replay/auction-demo.wav`, one file per provider (`deepgram`, `groq`). `atMs` is the offset from the
  start of the clip. Cached replay mode (R-VOX-082) plays these without keys or network.
- `llm-cache/<key>.json`: recorded model output, keyed by `sha256(transcript + "\n" + canonical json of
the prompt context)` (R-VOX-060). Replay mode throws `LlmCacheMissError` on a miss; it never calls
  the network.

Provenance: no live provider key was available when these were written, so the events are built from
the reference transcripts of the clip (see `audio/LICENSES.md`) with timings taken from
`replay/timeline.json`, and `source` says `reference-transcript`. They are not captures of a provider
run. When the live run of gate G5 happens, re-record with the record mode of the model client and
replace the files; keep the file names.
