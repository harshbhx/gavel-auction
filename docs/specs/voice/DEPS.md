# DEPS: voice (VOX)

Dependency note for packages/voice. Keys are VOX-nn. Waves: 1 = start now, 2 = needs wave 1 interfaces, 3 = integration, 4 = polish and submission.

## Critical path

VOX-02 types -> VOX-09 SttProvider/FakeStt -> VOX-30..32 segmenter -> VOX-51 pipeline -> VOX-52/53 faults -> VOX-67 session -> VOX-66 replay e2e.
Parser chain: VOX-12 numbers -> VOX-33 core -> VOX-34..38 -> VOX-39 parity (needs VOX-10 golden).
Decision chain: VOX-43 score -> VOX-44 merge, VOX-45 validate -> VOX-46 policy -> VOX-50 decide -> VOX-49 answers.
G5 chain: VOX-14, VOX-15, VOX-16, VOX-17 (keys, blocked on the project owner) -> VOX-29, VOX-42, VOX-55 -> VOX-59 -> VOX-60, VOX-61, VOX-65.

## Wave 1 (no dependencies)

Can all start at once: VOX-01, VOX-02, VOX-03, VOX-04, VOX-05, VOX-06, VOX-07, VOX-08, VOX-09, VOX-10, VOX-12, VOX-13, VOX-14, VOX-15, VOX-16, VOX-17, VOX-18

## What each issue unblocks

- VOX-01 (Scaffold packages/voice with lint, size and determinism guards) unblocks: nothing further
- VOX-02 (Public types, reason codes and zod schemas) unblocks: VOX-19, VOX-30, VOX-33, VOX-41, VOX-43, VOX-44, VOX-45, VOX-47, VOX-50, VOX-54, VOX-68, VOX-71
- VOX-03 (Audio frame codec (12-byte header, 20 ms frames)) unblocks: VOX-20, VOX-62, VOX-67
- VOX-04 (Resampler to 16 kHz and float32-to-int16 conversion) unblocks: VOX-20
- VOX-05 (Bounded drop-oldest audio queue with discontinuity flags) unblocks: VOX-22, VOX-69
- VOX-06 (Level meter (RMS dBFS, normalized, clipping)) unblocks: nothing further
- VOX-07 (Frame assembler: arbitrary chunks to 20 ms frames and 100 ms batches) unblocks: VOX-20, VOX-62
- VOX-08 (Energy endpointer and WAV encoder for chunked providers) unblocks: VOX-26
- VOX-09 (SttProvider interface, FakeStt and conformance suite) unblocks: VOX-24, VOX-26, VOX-27, VOX-28, VOX-30, VOX-62
- VOX-10 (Text corpus: port parser_cases.py to JSON and export Python golden) unblocks: VOX-11, VOX-39, VOX-40
- VOX-11 (Held-out hash guard) unblocks: nothing further
- VOX-12 (Number-word and numeral module (port of the parser lexicon)) unblocks: VOX-33
- VOX-13 (Privacy notice strings and data-handling doc) unblocks: nothing further
- VOX-14 (Audio fixture manifest, label schema and validator) unblocks: nothing further
- VOX-15 (Fixture tooling: TTS rendering, noise mixing, normalization (GitHub Actions)) unblocks: VOX-59, VOX-65
- VOX-16 (Record team-voice utterances with written consent) unblocks: VOX-59, VOX-65
- VOX-17 (Provide Deepgram and Groq keys privately) unblocks: VOX-59
- VOX-18 (Replay timeline schema and asset budget checker) unblocks: VOX-63, VOX-65
- VOX-19 (CaptureController state machine and user messages) unblocks: VOX-20, VOX-22
- VOX-20 (AudioWorklet module and getUserMedia controller) unblocks: VOX-21, VOX-23
- VOX-21 (Mute, push-to-talk, keepalive, device loss and suspended context) unblocks: nothing further
- VOX-22 (Degraded state from sustained drops) unblocks: nothing further
- VOX-23 (Capture CPU and size measurement in Actions) unblocks: nothing further
- VOX-24 (Deepgram provider: streaming socket, config object, keepalive) unblocks: VOX-25, VOX-27, VOX-29
- VOX-25 (Deepgram keyterms, reconnect backoff and write back-pressure) unblocks: nothing further
- VOX-26 (Groq Whisper provider over chunks) unblocks: VOX-27, VOX-29
- VOX-27 (Failover wrapper with 5 s audio replay and circuit) unblocks: nothing further
- VOX-28 (Web Speech try-it provider) unblocks: nothing further
- VOX-29 (Provider selection, secret scan and error classification) unblocks: VOX-59
- VOX-30 (Segmenter: final/utterance_end rules, interim captions, size limits) unblocks: VOX-31, VOX-32, VOX-51
- VOX-31 (Segmenter: gap split, multi-bidder keep-together, auctioneer echo filter) unblocks: VOX-51
- VOX-32 (Segmenter: duplicate suppression, idempotency key, pending candidate context) unblocks: VOX-51
- VOX-33 (Parser core: normalization, amounts, currency variants) unblocks: VOX-34, VOX-35, VOX-36, VOX-37, VOX-38, VOX-39
- VOX-34 (Parser: paddle extraction and speaker conflict) unblocks: VOX-36, VOX-38, VOX-39
- VOX-35 (Parser: ASR repair and to/too/for ambiguity) unblocks: VOX-39
- VOX-36 (Parser: corrections, make-it, retraction) unblocks: VOX-39, VOX-51
- VOX-37 (Parser: negations, hedges, questions, auctioneer talk) unblocks: VOX-39
- VOX-38 (Parser: homophones, multiples, implausible amounts, spans) unblocks: VOX-39
- VOX-39 (Parser parity harness against Python golden, properties, benchmark) unblocks: VOX-58
- VOX-40 (Extended case corpus (60 new cases)) unblocks: nothing further
- VOX-41 (Language-model schema, prompt and injection safety) unblocks: VOX-42
- VOX-42 (LlmParser client: timeout, abort, cache and fake) unblocks: VOX-51, VOX-55, VOX-59
- VOX-43 (Confidence scorer) unblocks: VOX-44, VOX-46
- VOX-44 (Merge of rules and model results (decision table)) unblocks: nothing further
- VOX-45 (Validator against engine context) unblocks: VOX-46, VOX-49
- VOX-46 (Policy: thresholds and hard flags) unblocks: VOX-50
- VOX-47 (Confirm wording templates and amount formatting) unblocks: VOX-48
- VOX-48 (Prompt lifecycle: TTL, supersede, rate limit) unblocks: VOX-49
- VOX-49 (Confirm answers: re-validate and spoken yes/no) unblocks: VOX-51
- VOX-50 (Decision audit record, evidence and accessibility payloads) unblocks: VOX-51
- VOX-51 (VoicePipeline orchestrator with injected clock and ids) unblocks: VOX-52, VOX-53, VOX-67, VOX-70
- VOX-52 (Pipeline fault handling: silence, empty, garbage, model and STT outage) unblocks: nothing further
- VOX-53 (Crosstalk handling and console reject action) unblocks: nothing further
- VOX-54 (Eval harness: metrics and G5 gate function) unblocks: VOX-55, VOX-56
- VOX-55 (Eval modes and CLI (text, cached, live) with limits) unblocks: VOX-57, VOX-58, VOX-59
- VOX-56 (Eval report, threshold sweep, deterministic output) unblocks: VOX-57, VOX-61
- VOX-57 (voice-eval workflow in Actions (text and cached on PRs, live on dispatch)) unblocks: nothing further
- VOX-58 (G5 step 1: text-level run and written results) unblocks: nothing further
- VOX-59 (G5 step 2: live audio run (needs keys) and gate decision) unblocks: VOX-60, VOX-61, VOX-72
- VOX-60 (Record STT and model outputs as committed cache fixtures) unblocks: VOX-63
- VOX-61 (Calibrate AUTO and CONFIRM thresholds from the sweep) unblocks: nothing further
- VOX-62 (Replay AudioSource: WAV to frames at 1x and 4x) unblocks: VOX-63
- VOX-63 (Cached replay: recorded STT events from timeline and expectation diff) unblocks: VOX-64
- VOX-64 (Replay labelling: replay flag on all events and UI label payload) unblocks: VOX-66
- VOX-65 (Produce the replay auction clip (at most 90 s)) unblocks: VOX-66, VOX-72
- VOX-66 (Replay end-to-end test in Actions) unblocks: VOX-73
- VOX-67 (VoiceSession adapter and audio WebSocket contract) unblocks: VOX-66
- VOX-68 (Logging and metrics interface) unblocks: VOX-70
- VOX-69 (No-audio-at-rest: ring buffers and opt-in recorder) unblocks: nothing further
- VOX-70 (Latency instrumentation and budget check) unblocks: nothing further
- VOX-71 (Contract PR to shared and server: evidence field and audio error codes) unblocks: nothing further
- VOX-72 (Voice README, operator runbook and demo script) unblocks: VOX-73
- VOX-73 (Demo rehearsal: 20 second voice segment, live and cached fallback) unblocks: nothing further

## External dependencies

- Realtime owner: VOX-71 agrees bid.voice evidence and /audio error codes; VOX-67 is mounted by the server.
- Engine owner: BidContext snapshot (section 14 item 3) needed by VOX-45 integration tests; unit tests use fakes.
- Web owner: consumes CaptureState, captions, prompts, strings (VOX-19, VOX-47, VOX-50, VOX-64).
- Quality owner: reviews VOX-57 and VOX-66 workflows.
- Project owner: VOX-17 keys, VOX-16 consent.

## Coverage: requirement id -> issue keys

| Requirement | Issues                         |
| ----------- | ------------------------------ |
| R-VOX-001   | VOX-20                         |
| R-VOX-002   | VOX-20                         |
| R-VOX-003   | VOX-04                         |
| R-VOX-004   | VOX-03                         |
| R-VOX-005   | VOX-07                         |
| R-VOX-006   | VOX-05                         |
| R-VOX-007   | VOX-22                         |
| R-VOX-008   | VOX-06                         |
| R-VOX-009   | VOX-19                         |
| R-VOX-010   | VOX-21                         |
| R-VOX-011   | VOX-21                         |
| R-VOX-012   | VOX-09                         |
| R-VOX-013   | VOX-09                         |
| R-VOX-014   | VOX-24                         |
| R-VOX-015   | VOX-25                         |
| R-VOX-016   | VOX-24                         |
| R-VOX-017   | VOX-26                         |
| R-VOX-018   | VOX-08                         |
| R-VOX-019   | VOX-27                         |
| R-VOX-020   | VOX-25                         |
| R-VOX-021   | VOX-28                         |
| R-VOX-022   | VOX-29                         |
| R-VOX-023   | VOX-29                         |
| R-VOX-024   | VOX-26                         |
| R-VOX-025   | VOX-09                         |
| R-VOX-026   | VOX-09                         |
| R-VOX-027   | VOX-30                         |
| R-VOX-028   | VOX-30                         |
| R-VOX-029   | VOX-31                         |
| R-VOX-030   | VOX-31                         |
| R-VOX-031   | VOX-31                         |
| R-VOX-032   | VOX-32                         |
| R-VOX-033   | VOX-30                         |
| R-VOX-034   | VOX-32                         |
| R-VOX-035   | VOX-33, VOX-39                 |
| R-VOX-036   | VOX-10, VOX-39                 |
| R-VOX-037   | VOX-12, VOX-40                 |
| R-VOX-038   | VOX-33                         |
| R-VOX-039   | VOX-33                         |
| R-VOX-040   | VOX-34                         |
| R-VOX-041   | VOX-34                         |
| R-VOX-042   | VOX-35                         |
| R-VOX-043   | VOX-36                         |
| R-VOX-044   | VOX-36, VOX-51                 |
| R-VOX-045   | VOX-37                         |
| R-VOX-046   | VOX-37                         |
| R-VOX-047   | VOX-37                         |
| R-VOX-048   | VOX-38                         |
| R-VOX-049   | VOX-38                         |
| R-VOX-050   | VOX-36                         |
| R-VOX-051   | VOX-38                         |
| R-VOX-052   | VOX-39                         |
| R-VOX-053   | VOX-38                         |
| R-VOX-054   | VOX-42                         |
| R-VOX-055   | VOX-41                         |
| R-VOX-056   | VOX-42                         |
| R-VOX-057   | VOX-41                         |
| R-VOX-058   | VOX-44                         |
| R-VOX-059   | VOX-44                         |
| R-VOX-060   | VOX-42, VOX-60                 |
| R-VOX-061   | VOX-01                         |
| R-VOX-062   | VOX-43                         |
| R-VOX-063   | VOX-46, VOX-61                 |
| R-VOX-064   | VOX-45                         |
| R-VOX-065   | VOX-46                         |
| R-VOX-066   | VOX-47                         |
| R-VOX-067   | VOX-48                         |
| R-VOX-068   | VOX-48                         |
| R-VOX-069   | VOX-49                         |
| R-VOX-070   | VOX-49                         |
| R-VOX-071   | VOX-02, VOX-50                 |
| R-VOX-072   | VOX-50                         |
| R-VOX-073   | VOX-14, VOX-16                 |
| R-VOX-074   | VOX-54                         |
| R-VOX-075   | VOX-55, VOX-57                 |
| R-VOX-076   | VOX-54, VOX-59                 |
| R-VOX-077   | VOX-10, VOX-11, VOX-40, VOX-58 |
| R-VOX-078   | VOX-56                         |
| R-VOX-079   | VOX-15                         |
| R-VOX-080   | VOX-55                         |
| R-VOX-081   | VOX-62, VOX-66                 |
| R-VOX-082   | VOX-60, VOX-63                 |
| R-VOX-083   | VOX-18, VOX-63                 |
| R-VOX-084   | VOX-64                         |
| R-VOX-085   | VOX-18, VOX-65                 |
| R-VOX-086   | VOX-52                         |
| R-VOX-087   | VOX-52                         |
| R-VOX-088   | VOX-52                         |
| R-VOX-089   | VOX-52                         |
| R-VOX-090   | VOX-52                         |
| R-VOX-091   | VOX-29                         |
| R-VOX-092   | VOX-53                         |
| R-VOX-093   | VOX-51                         |
| R-VOX-094   | VOX-69                         |
| R-VOX-095   | VOX-13                         |
| R-VOX-096   | VOX-13                         |
| R-VOX-097   | VOX-67                         |
| R-VOX-098   | VOX-68                         |
| R-VOX-099   | VOX-16                         |
| R-VOX-100   | VOX-13, VOX-72                 |
| R-VOX-101   | VOX-59, VOX-70                 |
| R-VOX-102   | VOX-51, VOX-66                 |
| R-VOX-103   | VOX-01                         |
| R-VOX-104   | VOX-23                         |
| R-VOX-105   | VOX-68                         |

## Coverage: test id -> issue keys

| Test      | Issues                 |
| --------- | ---------------------- |
| T-VOX-001 | VOX-20                 |
| T-VOX-002 | VOX-20                 |
| T-VOX-003 | VOX-04                 |
| T-VOX-004 | VOX-04                 |
| T-VOX-005 | VOX-03                 |
| T-VOX-006 | VOX-07                 |
| T-VOX-007 | VOX-05                 |
| T-VOX-008 | VOX-05                 |
| T-VOX-009 | VOX-22                 |
| T-VOX-010 | VOX-06                 |
| T-VOX-011 | VOX-19                 |
| T-VOX-012 | VOX-21                 |
| T-VOX-013 | VOX-29                 |
| T-VOX-014 | VOX-24                 |
| T-VOX-015 | VOX-25                 |
| T-VOX-016 | VOX-24                 |
| T-VOX-017 | VOX-08                 |
| T-VOX-018 | VOX-26                 |
| T-VOX-019 | VOX-27                 |
| T-VOX-020 | VOX-25                 |
| T-VOX-021 | VOX-28                 |
| T-VOX-022 | VOX-29                 |
| T-VOX-023 | VOX-29                 |
| T-VOX-024 | VOX-26                 |
| T-VOX-025 | VOX-09                 |
| T-VOX-026 | VOX-09                 |
| T-VOX-027 | VOX-30                 |
| T-VOX-028 | VOX-30                 |
| T-VOX-029 | VOX-31                 |
| T-VOX-030 | VOX-31                 |
| T-VOX-031 | VOX-31                 |
| T-VOX-032 | VOX-32                 |
| T-VOX-033 | VOX-30                 |
| T-VOX-034 | VOX-32                 |
| T-VOX-035 | VOX-39                 |
| T-VOX-036 | VOX-39                 |
| T-VOX-037 | VOX-12                 |
| T-VOX-038 | VOX-33                 |
| T-VOX-039 | VOX-33                 |
| T-VOX-040 | VOX-34                 |
| T-VOX-041 | VOX-34                 |
| T-VOX-042 | VOX-35                 |
| T-VOX-043 | VOX-36                 |
| T-VOX-044 | VOX-36                 |
| T-VOX-045 | VOX-37                 |
| T-VOX-046 | VOX-37                 |
| T-VOX-047 | VOX-37                 |
| T-VOX-048 | VOX-38                 |
| T-VOX-049 | VOX-38                 |
| T-VOX-050 | VOX-36                 |
| T-VOX-051 | VOX-38                 |
| T-VOX-052 | VOX-39                 |
| T-VOX-053 | VOX-38                 |
| T-VOX-054 | VOX-39                 |
| T-VOX-055 | VOX-11                 |
| T-VOX-056 | VOX-40                 |
| T-VOX-057 | VOX-34                 |
| T-VOX-058 | VOX-33                 |
| T-VOX-059 | VOX-37                 |
| T-VOX-060 | VOX-38                 |
| T-VOX-061 | VOX-39                 |
| T-VOX-062 | VOX-38                 |
| T-VOX-063 | VOX-41                 |
| T-VOX-064 | VOX-42                 |
| T-VOX-065 | VOX-41                 |
| T-VOX-066 | VOX-44                 |
| T-VOX-067 | VOX-42, VOX-60         |
| T-VOX-068 | VOX-01                 |
| T-VOX-069 | VOX-44                 |
| T-VOX-070 | VOX-43                 |
| T-VOX-071 | VOX-46, VOX-61         |
| T-VOX-072 | VOX-45                 |
| T-VOX-073 | VOX-46                 |
| T-VOX-074 | VOX-47                 |
| T-VOX-075 | VOX-48                 |
| T-VOX-076 | VOX-48                 |
| T-VOX-077 | VOX-49                 |
| T-VOX-078 | VOX-49                 |
| T-VOX-079 | VOX-02, VOX-50         |
| T-VOX-080 | VOX-50                 |
| T-VOX-081 | VOX-14                 |
| T-VOX-082 | VOX-54                 |
| T-VOX-083 | VOX-55, VOX-57         |
| T-VOX-084 | VOX-54                 |
| T-VOX-085 | VOX-10, VOX-40, VOX-58 |
| T-VOX-086 | VOX-56                 |
| T-VOX-087 | VOX-15                 |
| T-VOX-088 | VOX-55                 |
| T-VOX-089 | VOX-62                 |
| T-VOX-090 | VOX-63                 |
| T-VOX-091 | VOX-64                 |
| T-VOX-092 | VOX-18, VOX-65         |
| T-VOX-093 | VOX-66                 |
| T-VOX-094 | VOX-52                 |
| T-VOX-095 | VOX-52                 |
| T-VOX-096 | VOX-52                 |
| T-VOX-097 | VOX-52                 |
| T-VOX-098 | VOX-52                 |
| T-VOX-099 | VOX-29                 |
| T-VOX-100 | VOX-53                 |
| T-VOX-101 | VOX-51                 |
| T-VOX-102 | VOX-69                 |
| T-VOX-103 | VOX-50                 |
| T-VOX-104 | VOX-13                 |
| T-VOX-105 | VOX-67                 |
| T-VOX-106 | VOX-68                 |
| T-VOX-107 | VOX-16                 |
| T-VOX-108 | VOX-13, VOX-72         |
| T-VOX-109 | VOX-59, VOX-70         |
| T-VOX-110 | VOX-51                 |
| T-VOX-111 | VOX-01                 |
| T-VOX-112 | VOX-23                 |
| T-VOX-113 | VOX-68                 |
| T-VOX-114 | VOX-51                 |
