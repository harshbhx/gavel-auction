export const NAME_MAX = 24;

export function validName(raw: string): boolean {
  const n = raw.trim().length;
  return n >= 1 && n <= NAME_MAX;
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
