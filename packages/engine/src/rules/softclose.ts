import type { LotState } from '../state.js';

/**
 * The latest `endsAt` the lot may reach (R-ENG-036): `openedAt + hardCloseMs`, moved by the
 * time the clock stood still in finished pauses, since no one could bid then (R12-E08). Null
 * when the lot has no hard close or has not opened.
 */
export function hardCloseOf(lot: LotState): number | null {
  const hard = lot.config?.softClose.hardCloseMs;
  if (hard === undefined || lot.openedAt === null) return null;
  return lot.openedAt + hard + (lot.pausedTotalMs ?? 0);
}

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
  const hard = hardCloseOf(lot);
  if (hard !== null) endsAt = Math.min(endsAt, Math.max(lot.endsAt, hard));
  return { endsAt, extended: endsAt > lot.endsAt };
}
