import { GavelError } from './errors';

declare const centsBrand: unique symbol;

/** Integer amount in cents, 0..99_999_999_999. */
export type Cents = number & { readonly [centsBrand]: 'Cents' };

export const MAX_CENTS = 99_999_999_999;

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_CENTS;
}

/** Brand an integer cent amount. Throws `bad_amount` for floats, NaN, negatives and out-of-range values. */
export function Cents(value: number): Cents {
  if (!isCents(value)) {
    throw new GavelError('bad_amount', 'amount must be an integer number of cents in range');
  }
  return value;
}

const checked = (value: number): Cents => {
  if (!isCents(value)) {
    throw new GavelError('bad_amount', 'amount must be an integer number of cents in range');
  }
  return value;
};

/** a + b, throwing `bad_amount` when the result leaves 0..MAX_CENTS. */
export function add(a: Cents, b: Cents): Cents {
  return checked(a + b);
}

/** a - b, throwing `bad_amount` when the result would be negative. */
export function sub(a: Cents, b: Cents): Cents {
  return checked(a - b);
}

/** Three-way compare: negative, zero or positive. */
export function cmp(a: Cents, b: Cents): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function min(a: Cents, b: Cents): Cents {
  return a <= b ? a : b;
}

export function max(a: Cents, b: Cents): Cents {
  return a >= b ? a : b;
}
