import type { Scenario } from '../../net/transport';
import { parseServerMessage, type RoomConfigView, type ServerMessage } from '../../wire';

/** Recording bundle format, events.json v1 (OQ-WEB-5). Audio is a separate optional file. */
export const BUNDLE_VERSION = 1;

export interface ReplayEvent {
  /** Milliseconds from the start of the recording. */
  t: number;
  msg: ServerMessage;
}

export interface ReplayBundle {
  version: typeof BUNDLE_VERSION;
  title: string;
  /** Offset of the last event. */
  durationMs: number;
  roomConfig: RoomConfigView;
  events: ReplayEvent[];
}

export type BundleError = 'not_object' | 'version' | 'events' | 'event' | 'order' | 'no_state';

export type BundleResult =
  | { ok: true; bundle: ReplayBundle }
  | { ok: false; error: BundleError; index?: number };

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates an unknown value (usually parsed JSON). Never throws. */
export function parseBundle(raw: unknown): BundleResult {
  if (!isRec(raw)) return { ok: false, error: 'not_object' };
  if (raw['version'] !== BUNDLE_VERSION) return { ok: false, error: 'version' };
  const rawEvents = raw['events'];
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) return { ok: false, error: 'events' };

  const events: ReplayEvent[] = [];
  let previous = 0;
  for (let index = 0; index < rawEvents.length; index += 1) {
    const item: unknown = rawEvents[index];
    if (!isRec(item)) return { ok: false, error: 'event', index };
    const t = item['t'];
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0)
      return { ok: false, error: 'event', index };
    const msg = parseServerMessage(item['msg']);
    if (msg === null) return { ok: false, error: 'event', index };
    if (t < previous) return { ok: false, error: 'order', index };
    previous = t;
    events.push({ t, msg });
  }

  const firstState = events.find((e) => e.msg.t === 'state')?.msg;
  if (firstState === undefined || firstState.t !== 'state') return { ok: false, error: 'no_state' };

  const title = typeof raw['title'] === 'string' ? raw['title'] : firstState.room.name;
  return {
    ok: true,
    bundle: {
      version: BUNDLE_VERSION,
      title,
      durationMs: previous,
      roomConfig: firstState.room.config,
      events,
    },
  };
}

/** Plays the recording through ScenarioTransport: every event keeps its recorded offset. */
export function bundleToScenario(bundle: ReplayBundle): Scenario {
  return {
    name: bundle.title,
    description: bundle.title,
    roomConfig: bundle.roomConfig,
    steps: bundle.events.map((e) => ({ at: e.t, emit: e.msg })),
  };
}

export type ChapterId = 'reg' | 'bid' | 'confirm' | 'hammer' | 'settle';

/** Offset of the first message of each chapter that the recording contains. */
export function chapterOffsets(bundle: ReplayBundle): Partial<Record<ChapterId, number>> {
  const out: Partial<Record<ChapterId, number>> = {};
  const mark = (id: ChapterId, t: number): void => {
    if (out[id] === undefined) out[id] = t;
  };
  for (const { t, msg } of bundle.events) {
    if (msg.t === 'registered') mark('reg', t);
    else if (msg.t === 'bid') mark('bid', t);
    else if (msg.t === 'confirm_request') mark('confirm', t);
    else if (msg.t === 'hammer') mark('hammer', t);
    else if (msg.t === 'settlement_update') mark('settle', t);
  }
  return out;
}
