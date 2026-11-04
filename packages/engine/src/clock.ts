export interface Clock {
  nowMs(): number;
}

/** The only wall-clock reader in the package; hosts pass its value in as `at`. */
export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  private t: number;
  constructor(start = 0) {
    this.t = start;
  }
  nowMs(): number {
    return this.t;
  }
  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

export function monotonicAt(now: number, headAt: number): number {
  return Math.max(now, headAt);
}
