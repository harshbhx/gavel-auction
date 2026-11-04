import { GavelError } from './errors';
import { Cents } from './money';

const USD_RE = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Format cents as `$1,250.00` using integer arithmetic only. */
export function formatUsd(cents: Cents): string {
  const whole = Math.floor(cents / 100);
  const frac = cents - whole * 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}.${String(frac).padStart(2, '0')}`;
}

/**
 * Parse `350`, `350.5`, `$350.50` or `1,250` into cents without floats.
 * Throws `bad_amount` for anything else, including more than two decimals.
 */
export function parseUsd(text: string): Cents {
  const match = USD_RE.exec(text.trim());
  if (!match) {
    throw new GavelError('bad_amount', 'invalid amount');
  }
  const digits = (match[1] ?? '').replace(/,/g, '').replace(/^0+(?=\d)/, '');
  if (digits.length > 12) {
    throw new GavelError('bad_amount', 'amount out of range');
  }
  const frac = (match[2] ?? '').padEnd(2, '0');
  return Cents(Number(digits) * 100 + Number(frac));
}
