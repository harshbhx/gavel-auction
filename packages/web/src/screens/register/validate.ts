import { BIDDER_NAME_FORBIDDEN_PATTERN } from '@gavel/shared';

/** The server and the wire schema take up to 64 characters (docs/PRIVACY.md). */
export const NAME_MAX = 64;

/** True when the name holds a character the server refuses (control, invisible, < or >). */
export function nameHasForbidden(raw: string): boolean {
  return BIDDER_NAME_FORBIDDEN_PATTERN.test(raw);
}

export function validName(raw: string): boolean {
  const n = raw.trim().length;
  return n >= 1 && n <= NAME_MAX && !nameHasForbidden(raw.trim());
}

/** Whole dollars only. Returns cents, or null when the text is not a whole dollar amount. */
export function parseWholeDollars(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw.trim())) return null;
  return Number(raw.trim()) * 100;
}

/** A custom ceiling is valid from the room minimum to the room maximum cap, inclusive. */
export function customCeilingCents(raw: string, minCents: number, maxCents: number): number | null {
  const cents = parseWholeDollars(raw);
  return cents !== null && cents >= minCents && cents <= maxCents ? cents : null;
}

const CENT_DOLLAR = 100;
/** Used only when a server sends no cap and the room has no presets (older servers). */
const FALLBACK_MAX_CENTS = 100000;

/**
 * The limit a bidder may type, in whole-dollar cents: from the reserve (a limit under it could
 * never bid) up to the cap the server sends in the room snapshot (`maxCeilingCents`). An older
 * server sends no cap; the largest preset then stands in for it, so the field never offers more
 * than the room is known to take.
 */
export function ceilingRange(
  reserveCents: number | undefined,
  capCents: number | undefined,
  presetsCents: readonly number[] | undefined,
): { minCents: number; maxCents: number } {
  const known = presetsCents !== undefined && presetsCents.length > 0;
  const cap = capCents ?? (known ? Math.max(...presetsCents) : FALLBACK_MAX_CENTS);
  const maxCents = Math.max(CENT_DOLLAR, Math.floor(cap / CENT_DOLLAR) * CENT_DOLLAR);
  const floor = Math.ceil((reserveCents ?? 0) / CENT_DOLLAR) * CENT_DOLLAR;
  return { minCents: Math.min(maxCents, Math.max(CENT_DOLLAR, floor)), maxCents };
}
