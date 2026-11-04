import { GavelError } from './errors';
import { Cents, MAX_CENTS } from './money';

export function addCents(a: Cents, b: Cents): Cents {
  const result = a + b;
  if (result > MAX_CENTS) {
    throw new GavelError('bad_amount', 'addition overflow');
  }
  return result as Cents;
}

export function subCents(a: Cents, b: Cents): Cents {
  const result = a - b;
  if (result < 0) {
    throw new GavelError('bad_amount', 'subtraction underflow');
  }
  return result as Cents;
}

export function cmpCents(a: Cents, b: Cents): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function minCents(a: Cents, b: Cents): Cents {
  return (a <= b ? a : b) as Cents;
}

export function maxCents(a: Cents, b: Cents): Cents {
  return (a >= b ? a : b) as Cents;
}
