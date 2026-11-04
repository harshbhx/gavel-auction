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
