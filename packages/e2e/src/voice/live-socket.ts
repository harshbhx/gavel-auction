/**
 * Pure helpers for the live /audio socket run (issue 2194): reading a clip, cutting it into the
 * socket's audio batches, and turning what was observed per clip into a report. Nothing here
 * touches the network or the clock, so every number in the report is computed from observations
 * the caller passes in and the whole file is unit tested.
 */

/**
 * The ceiling every bidder of the live run holds, in cents. The server refuses holds above
 * GAVEL_MAX_CEILING_CENTS (default 100000), so the run raises the cap to this value; a ceiling
 * above the cap makes the enrol route answer 500 (seen in the first dispatch of the run).
 */
export const CEILING_CENTS = 500_000;
export const LIVE_STACK_ENV: Readonly<Record<string, string>> = {
  GAVEL_MAX_CEILING_CENTS: String(CEILING_CENTS),
};

export const SAMPLE_RATE = 16_000;
/** Samples in one 20 ms frame (the socket's frame size). */
export const FRAME_SAMPLES = 320;
/** Frames per socket message in this run: 100 ms of audio. */
export const FRAMES_PER_BATCH = 5;

/** Flag bits of the socket's binary header (packages/voice/src/audio/frame.ts). */
export const FLAG_KEEPALIVE = 2;
export const FLAG_END_OF_UTTERANCE = 8;

export class WavError extends Error {}

export interface WavPcm {
  sampleRate: number;
  channels: number;
  samples: Int16Array;
}

/** Reads a RIFF WAVE file with 16 bit PCM. Other layouts are refused with a clear message. */
export function parseWav(buf: Uint8Array): WavPcm {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (at: number): string => String.fromCharCode(...buf.subarray(at, at + 4));
  if (buf.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE')
    throw new WavError('not a WAVE file');
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined;
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (fmt === undefined) throw new WavError('data chunk before fmt chunk');
      if (fmt.format !== 1 || fmt.bits !== 16) throw new WavError('only 16 bit PCM is supported');
      const end = Math.min(body + size, buf.length);
      const count = Math.floor((end - body) / 2);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(body + i * 2, true);
      return { sampleRate: fmt.rate, channels: fmt.channels, samples };
    }
    at = body + size + (size % 2);
  }
  throw new WavError('no data chunk');
}

export interface Batch {
  pcm: Int16Array;
  /** Position of the batch's first sample in the clip, in ms. */
  offsetMs: number;
  frames: number;
}

/**
 * Cuts samples into batches of `framesPerBatch` whole 20 ms frames. The last frame is padded with
 * zeros (silence), which is what a microphone would send. Never returns an empty batch.
 */
export function toBatches(samples: Int16Array, framesPerBatch = FRAMES_PER_BATCH): Batch[] {
  const perBatch = FRAME_SAMPLES * framesPerBatch;
  const out: Batch[] = [];
  for (let start = 0; start < samples.length; start += perBatch) {
    const slice = samples.subarray(start, Math.min(start + perBatch, samples.length));
    const frames = Math.ceil(slice.length / FRAME_SAMPLES);
    const pcm = new Int16Array(frames * FRAME_SAMPLES);
    pcm.set(slice);
    out.push({ pcm, offsetMs: Math.round((start / SAMPLE_RATE) * 1000), frames });
  }
  return out;
}

/** Lower case, letters and digits only, single spaces: the form two transcripts are compared in. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ExpectedOutcome {
  outcome: 'bid' | 'confirm' | 'none';
  amountCents?: number;
  paddle?: string;
}

export interface Caption {
  /** Wall time the caption reached the client, ms. */
  at: number;
  text: string;
  final: boolean;
}

export interface ClipObservation {
  id: string;
  /** What the synthetic clip says (from the manifest). */
  spokenText: string;
  expected: ExpectedOutcome;
  /** Wall time the first audio batch was sent, ms. */
  startedAt: number;
  /** Wall time the last audio batch was sent: the end of speech as the server saw it, ms. */
  speechEndAt: number;
  /** Wall time the observation window of this clip closed, ms. */
  endedAt: number;
  captions: Caption[];
  /** Status frames of the audio feed, in order, as `stt/llm`. */
  statuses: string[];
  /** Confirm prompts that reached a bidder socket during the window. */
  confirmPrompts: Array<{ paddle: string; amountCents: number }>;
  /** Price frames with a leader seen during the window: a bid that took effect without a reply. */
  pricesWithLeader: number[];
  /** Close code of the audio socket when the server closed it early. */
  closeCode?: number;
  error?: string;
}

export type RoomDecision = 'confirm_prompt' | 'auto_accepted' | 'no_room_action';

export interface ClipRow {
  id: string;
  spokenText: string;
  transcript: string;
  transcriptMatchesSpokenText: boolean;
  /** True when the live provider returned a non-empty final transcript for this clip. */
  providerAnswered: boolean;
  /** ms from the last audio batch to the first final caption; null when there was none. */
  captionLatencyMs: number | null;
  expectedOutcome: ExpectedOutcome['outcome'];
  expectedAmountCents: number | null;
  roomDecision: RoomDecision;
  confirmPrompts: Array<{ paddle: string; amountCents: number }>;
  autoAcceptedBids: number;
  statuses: string[];
  closeCode: number | null;
  error: string | null;
}

export function summarizeClip(o: ClipObservation): ClipRow {
  const finals = o.captions.filter((c) => c.final && c.text.trim() !== '');
  const transcript = finals.map((c) => c.text.trim()).join(' ');
  const firstFinal = finals[0];
  const autoAccepted = o.pricesWithLeader.length;
  const roomDecision: RoomDecision =
    autoAccepted > 0
      ? 'auto_accepted'
      : o.confirmPrompts.length > 0
        ? 'confirm_prompt'
        : 'no_room_action';
  return {
    id: o.id,
    spokenText: o.spokenText,
    transcript,
    transcriptMatchesSpokenText:
      transcript !== '' && normalizeText(transcript) === normalizeText(o.spokenText),
    providerAnswered: finals.length > 0,
    captionLatencyMs: firstFinal === undefined ? null : Math.max(0, firstFinal.at - o.speechEndAt),
    expectedOutcome: o.expected.outcome,
    expectedAmountCents: o.expected.amountCents ?? null,
    roomDecision,
    confirmPrompts: o.confirmPrompts,
    autoAcceptedBids: autoAccepted,
    statuses: [...new Set(o.statuses)],
    closeCode: o.closeCode ?? null,
    error: o.error ?? null,
  };
}

export interface LiveSocketReport {
  schema: 'voice-live-socket/1';
  verdict: 'PASS' | 'FAIL';
  verdictReason: string;
  provider: 'groq' | 'deepgram';
  /** Always `room`: the audio socket carries an auctioneer token, so this is the room microphone. */
  microphone: 'room';
  generatedAt: string;
  runUrl: string;
  clips: number;
  providerAnswered: number;
  transcriptMatches: number;
  confirmPrompts: number;
  autoAcceptedBids: number;
  noRoomAction: number;
  clipsWithError: number;
  captionLatencyMs: { count: number; min: number; p50: number; p95: number; max: number } | null;
  rows: ClipRow[];
  notes: string[];
}

function percentile(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? 0;
}

export function latencySummary(values: number[]): LiveSocketReport['captionLatencyMs'] {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return {
    count: s.length,
    min: s[0] ?? 0,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1] ?? 0,
  };
}

export function buildReport(input: {
  provider: 'groq' | 'deepgram';
  generatedAt: string;
  runUrl: string;
  rows: ClipRow[];
}): LiveSocketReport {
  const { rows } = input;
  const answered = rows.filter((r) => r.providerAnswered).length;
  const auto = rows.reduce((n, r) => n + r.autoAcceptedBids, 0);
  const confirms = rows.reduce((n, r) => n + r.confirmPrompts.length, 0);
  let verdict: 'PASS' | 'FAIL' = 'PASS';
  let reason = `the live provider answered ${answered} of ${rows.length} clips and no spoken bid was accepted without a confirm`;
  if (rows.length === 0) {
    verdict = 'FAIL';
    reason = 'no clip was streamed';
  } else if (answered === 0) {
    verdict = 'FAIL';
    reason = 'the live provider returned no transcript for any clip';
  } else if (auto > 0) {
    verdict = 'FAIL';
    reason = `${auto} spoken bid(s) took effect with no confirm on the room microphone`;
  }
  return {
    schema: 'voice-live-socket/1',
    verdict,
    verdictReason: reason,
    provider: input.provider,
    microphone: 'room',
    generatedAt: input.generatedAt,
    runUrl: input.runUrl,
    clips: rows.length,
    providerAnswered: answered,
    transcriptMatches: rows.filter((r) => r.transcriptMatchesSpokenText).length,
    confirmPrompts: confirms,
    autoAcceptedBids: auto,
    noRoomAction: rows.filter((r) => r.roomDecision === 'no_room_action').length,
    clipsWithError: rows.filter((r) => r.error !== null || r.closeCode !== null).length,
    captionLatencyMs: latencySummary(
      rows.flatMap((r) => (r.captionLatencyMs === null ? [] : [r.captionLatencyMs])),
    ),
    rows,
    notes: [
      'Synthetic clips (eSpeak, 16 kHz mono), streamed in real time over the /audio socket of the real server process.',
      'The server runs with an empty cached recording, so a transcript can only have come from the live provider.',
      'The socket carries an auctioneer token: this is the room microphone, where no bid is accepted without a confirm.',
      'No bidder answered a confirm prompt, so any price change in this run would be an unconfirmed bid.',
      'The web console has no audio sender; only the server socket path was run.',
    ],
  };
}

/** A short markdown rendering of the report for the job summary. */
export function reportMarkdown(r: LiveSocketReport): string {
  const lat = r.captionLatencyMs;
  const lines = [
    `### Live /audio socket run: ${r.provider}`,
    '',
    `VOICE LIVE SOCKET VERDICT: ${r.verdict} (${r.verdictReason})`,
    '',
    `- clips streamed: ${r.clips}; live provider answered: ${r.providerAnswered}; transcript equals the spoken text: ${r.transcriptMatches}`,
    `- room decisions: ${r.confirmPrompts} confirm prompt(s), ${r.autoAcceptedBids} bid(s) accepted without a confirm, ${r.noRoomAction} clip(s) with no room action`,
    lat === null
      ? '- caption latency after end of speech: no final caption'
      : `- caption latency after end of speech (ms): p50 ${lat.p50}, p95 ${lat.p95}, max ${lat.max} over ${lat.count} clips`,
    '',
    '| clip | transcript | answered | latency ms | room decision |',
    '| --- | --- | --- | --- | --- |',
    ...r.rows.map(
      (c) =>
        `| ${c.id} | ${c.transcript.replace(/\|/g, '/')} | ${c.providerAnswered ? 'yes' : 'no'} | ${c.captionLatencyMs ?? ''} | ${c.roomDecision} |`,
    ),
  ];
  return lines.join('\n');
}
