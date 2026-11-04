import type { LotState } from '../state.js';

/**
 * Whether an accepted bid at `at` extends the lot (R-ENG-034..037). Pure: the
 * caller emits END_EXTENDED and applies the new end time. Rejected bids must
 * not be passed here (R-ENG-039).
 */
export function extension(lot: LotState, at: number): { endsAt: number; extended: boolean } {
  const none = { endsAt: lot.endsAt ?? 0, extended: false };
  const cfg = lot.config;
  if (cfg === null || lot.endsAt === null) return none;
  if (cfg.mode === 'second_price') return none;
  const sc = cfg.softClose;
  if (sc.windowMs <= 0 || sc.extensionMs <= 0) return none;
  if (lot.extensions >= sc.maxExtensions) return none;
  if (at < lot.endsAt - sc.windowMs) return none;
  let endsAt = Math.max(lot.endsAt, at + sc.extensionMs);
  if (sc.hardCloseMs !== undefined && lot.openedAt !== null) {
    endsAt = Math.min(endsAt, Math.max(lot.endsAt, lot.openedAt + sc.hardCloseMs));
  }
  return { endsAt, extended: endsAt > lot.endsAt };
}
