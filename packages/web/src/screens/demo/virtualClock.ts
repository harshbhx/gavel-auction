/**
 * One virtual clock for a beat's dwell time: virtual += real * speed. Changing the speed folds the
 * time already spent at the old speed in first, so a switch never restarts or jumps the beat.
 */
export class VirtualClock {
  private spent = 0;
  private since: number | null = null;
  private rate = 1;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get speed(): number {
    return this.rate;
  }

  /** Virtual milliseconds spent so far. */
  get elapsed(): number {
    return this.spent + (this.since === null ? 0 : (this.now() - this.since) * this.rate);
  }

  get running(): boolean {
    return this.since !== null;
  }

  start(): void {
    if (this.since === null) this.since = this.now();
  }

  stop(): void {
    this.spent = this.elapsed;
    this.since = null;
  }

  reset(): void {
    this.spent = 0;
    if (this.since !== null) this.since = this.now();
  }

  setSpeed(speed: number): void {
    const was = this.running;
    this.stop();
    this.rate = speed;
    if (was) this.start();
  }

  /** Real milliseconds until `limit` virtual milliseconds have passed at the current speed. */
  realUntil(limit: number): number {
    return Math.max(0, (limit - this.elapsed) / this.rate);
  }
}
