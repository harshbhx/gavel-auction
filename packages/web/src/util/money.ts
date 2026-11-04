function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('cents must be a non-negative safe integer');
  }
}

function group(dollars: number): string {
  return String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 35000 -> "$350.00". Integer arithmetic only. */
export function formatUsd(cents: number): string {
  assertCents(cents);
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return `$${group(dollars)}.${String(rest).padStart(2, '0')}`;
}

/** Like formatUsd but drops ".00" for whole-dollar amounts. */
export function formatUsdCompact(cents: number): string {
  const full = formatUsd(cents);
  return full.endsWith('.00') ? full.slice(0, -3) : full;
}

const MONEY_INPUT = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** "350.5" -> 35050. Returns null for empty, zero, negative, exponent or more than 2 decimals. */
export function parseUsdToCents(input: string): number | null {
  const match = MONEY_INPUT.exec(input.trim());
  if (match === null) return null;
  const whole = (match[1] ?? '').replace(/,/g, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  if (whole.length > 12) return null;
  const cents = Number(whole) * 100 + Number(fraction);
  return cents > 0 ? cents : null;
}
