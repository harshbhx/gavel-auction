/**
 * Pure helpers for recording a judge-room auction as a replay bundle (inventory row 41). The
 * bundle is the web app's events.json v1: a list of server frames with their offset from the start
 * of the recording, played back by /replay/:recordingId through the real reducer. Only frames a
 * public screen may see are recorded. The bundle says in three places that its holds are
 * simulated: the title, `simulatedHolds: true` and `note`.
 */

export const BUNDLE_VERSION = 1;

export interface Frame {
  /** Wall time the frame reached the recorder, ms. */
  atMs: number;
  /** The decoded server frame. */
  msg: { t: string } & Record<string, unknown>;
}

export interface RecordingBundle {
  version: typeof BUNDLE_VERSION;
  title: string;
  simulatedHolds: true;
  note: string;
  recordedAt: string;
  events: Array<{ t: number; msg: Frame['msg'] }>;
}

export const SIMULATED_NOTE =
  'Recorded from a judge room on a real server process in CI. Every hold in this recording is a simulated hold (JUDGE_SIM_HOLDS): no PayPal call was made and no money moved.';

/** A decoder that returns the validated frame or null; the recorder passes the web app's schemas. */
export type Decode = (raw: unknown) => Frame['msg'] | null;

export interface BuildResult {
  bundle: RecordingBundle;
  /** Frames the decoder refused; they are left out so the player never meets an unknown frame. */
  dropped: number;
}

/**
 * Orders frames by arrival, drops the ones the decoder refuses, makes offsets start at 0 from the
 * first kept frame and never go backwards, and requires that a `state` frame comes first (the
 * player needs a snapshot to start from). Throws when no state frame was kept.
 */
export function buildRecording(input: {
  title: string;
  recordedAt: string;
  frames: readonly Frame[];
  decode: Decode;
}): BuildResult {
  const kept: Array<{ atMs: number; msg: Frame['msg'] }> = [];
  let dropped = 0;
  for (const f of [...input.frames].sort((a, b) => a.atMs - b.atMs)) {
    const msg = input.decode(f.msg);
    if (msg === null) dropped += 1;
    else kept.push({ atMs: f.atMs, msg });
  }
  const firstState = kept.findIndex((k) => k.msg.t === 'state');
  if (firstState < 0) throw new Error('no state frame was recorded');
  const events = kept.slice(firstState);
  const origin = events[0]?.atMs ?? 0;
  let last = 0;
  const shifted = events.map((e) => {
    last = Math.max(last, Math.max(0, e.atMs - origin));
    return { t: last, msg: e.msg };
  });
  return {
    bundle: {
      version: BUNDLE_VERSION,
      title: input.title,
      simulatedHolds: true,
      note: SIMULATED_NOTE,
      recordedAt: input.recordedAt,
      events: shifted,
    },
    dropped,
  };
}

export interface RecordingSummary {
  events: number;
  durationMs: number;
  byType: Record<string, number>;
  /** Price frames that carry a leader: a bid took the lead. */
  leadChanges: number;
  hammered: boolean;
  settlementUpdates: number;
}

export function summarizeRecording(b: RecordingBundle): RecordingSummary {
  const byType: Record<string, number> = {};
  let leadChanges = 0;
  for (const { msg } of b.events) {
    byType[msg.t] = (byType[msg.t] ?? 0) + 1;
    if (msg.t === 'price' && msg['leaderId'] !== null && msg['leaderId'] !== undefined) {
      leadChanges += 1;
    }
  }
  return {
    events: b.events.length,
    durationMs: b.events[b.events.length - 1]?.t ?? 0,
    byType,
    leadChanges,
    hammered: (byType['hammer'] ?? 0) > 0,
    settlementUpdates: byType['settlement_update'] ?? 0,
  };
}

/**
 * What a recording must have before it is worth hosting as a judge path: a bid took the lead and
 * the lot was hammered. Returns the reasons it is not, or an empty list.
 */
export function hostingProblems(s: RecordingSummary): string[] {
  const problems: string[] = [];
  if (s.leadChanges < 2)
    problems.push(`only ${s.leadChanges} bid(s) took the lead, need at least 2`);
  if (!s.hammered) problems.push('no hammer frame was recorded');
  return problems;
}
