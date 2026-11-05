export const NAME_MAX = 24;
export const PADDLE_MIN = 1;
export const PADDLE_MAX = 999;

export function validName(raw: string): boolean {
  const n = raw.trim().length;
  return n >= 1 && n <= NAME_MAX;
}

/** A paddle is a plain whole number from 1 to 999. Returns null when the text is not one. */
export function parsePaddle(raw: string): number | null {
  if (!/^\d{1,4}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= PADDLE_MIN && n <= PADDLE_MAX ? n : null;
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
