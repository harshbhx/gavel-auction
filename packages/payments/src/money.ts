export class MoneyError extends Error {
  code: 'not_integer' | 'negative' | 'too_large' | 'bad_format';
  constructor(code: MoneyError['code'], message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

const MAX_SAFE = 9007199254740991;

/** Integer cents to a PayPal decimal string, e.g. 1050 -> "10.50". */
export function centsToDecimal(cents: number): string {
  if (typeof cents !== 'number' || !isFinite(cents) || Math.trunc(cents) !== cents) {
    throw new MoneyError('not_integer', 'cents must be an integer');
  }
  if (cents < 0) throw new MoneyError('negative', 'cents must not be negative');
  if (cents > MAX_SAFE) throw new MoneyError('too_large', 'cents out of safe range');
  const digits = String(cents).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export interface DecimalOptions {
  /** Accept "5", "0.5" (fewer than 2 decimals). Default false. */
  lenient?: boolean;
}

/** Decimal string to integer cents, e.g. "10.50" -> 1050. No floating point. */
export function decimalToCents(value: string, opts: DecimalOptions = {}): number {
  const lenient = opts.lenient === true;
  if (typeof value !== 'string') throw new MoneyError('bad_format', 'amount must be a string');
  const pattern = lenient ? /^(\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)\.(\d{2})$/;
  const m = pattern.exec(value);
  if (!m) throw new MoneyError('bad_format', `invalid amount "${value}"`);
  const whole = m[1] ?? '';
  const frac = (m[2] ?? '').padEnd(2, '0');
  let cents = 0;
  for (const ch of whole + frac) {
    cents = cents * 10 + (ch.charCodeAt(0) - 48);
    if (cents > MAX_SAFE) throw new MoneyError('too_large', 'amount out of safe range');
  }
  return cents;
}
