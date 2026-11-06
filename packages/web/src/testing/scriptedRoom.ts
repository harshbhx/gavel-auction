import type { Scenario } from '../net/transport';

/** The room id the scripted transport joins; the address room id is only a label there. */
export const SCRIPTED_ROOM_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

export interface ScriptedRoom {
  readonly scenario: Scenario;
  /** The first bidder on the scripted roster, who stands in for this device on the bid route. */
  readonly bidderId: string | undefined;
}

const LOADERS: Readonly<Record<string, () => Promise<Scenario>>> = {
  happy: async () => (await import('./scenarios/happy')).happy,
  ambiguous_confirm: async () => (await import('./scenarios/ambiguous_confirm')).ambiguous_confirm,
  big_room_200_bids: async () => (await import('./scenarios/big_room_200_bids')).big_room_200_bids,
  failed_needs_review: async () =>
    (await import('./scenarios/failed_needs_review')).failed_needs_review,
  kill_switch: async () => (await import('./scenarios/kill_switch')).kill_switch,
  late_entry_closed: async () => (await import('./scenarios/late_entry_closed')).late_entry_closed,
  outbid_race: async () => (await import('./scenarios/outbid_race')).outbid_race,
  reconnect_gap: async () => (await import('./scenarios/reconnect_gap')).reconnect_gap,
  rejections: async () => (await import('./scenarios/rejections')).rejections,
  soft_close: async () => (await import('./scenarios/soft_close')).soft_close,
  winner_declined_fallback: async () =>
    (await import('./scenarios/winner_declined_fallback')).winner_declined_fallback,
};

/** Loads a scripted scenario by name, or null when there is no such scenario. */
export async function loadScriptedRoom(name: string): Promise<ScriptedRoom | null> {
  const load = Object.prototype.hasOwnProperty.call(LOADERS, name) ? LOADERS[name] : undefined;
  if (load === undefined) return null;
  const scenario = await load();
  for (const step of scenario.steps) {
    if (step.emit?.t === 'state') {
      return { scenario, bidderId: step.emit.snapshot.roster[0]?.bidderId };
    }
  }
  return { scenario, bidderId: undefined };
}
