declare const epochBrand: unique symbol;

/** Integer milliseconds since the Unix epoch. */
export type EpochMs = number & { readonly [epochBrand]: 'EpochMs' };

export function EpochMs(value: number): EpochMs {
  if (!Number.isInteger(value)) {
    throw new RangeError('EpochMs must be an integer');
  }
  return value as EpochMs;
}

export interface Clock {
  now(): EpochMs;
}

/** The only place Date.now is read in this package. */
export class SystemClock implements Clock {
  now(): EpochMs {
    return EpochMs(Date.now());
  }
}

/** Deterministic clock for tests. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: number = 0) {
    this.current = EpochMs(start);
  }

  now(): EpochMs {
    return EpochMs(this.current);
  }

  set(value: number): void {
    this.current = EpochMs(value);
  }

  advance(ms: number): void {
    this.current = EpochMs(this.current + ms);
  }
}
