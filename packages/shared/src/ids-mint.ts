import { CROCKFORD, parseId, type Ulid } from './ids';
import type { Clock } from './time';

/** Port for minting ids, so the room core never touches randomness or time directly. */
export interface Ids {
  mint<B extends string = string>(): Ulid<B>;
}

/** Fills a buffer with random bytes. Defaults to WebCrypto. */
export type RandomBytes = (buf: Uint8Array) => void;

const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const BASE = 32;
/** 2^48 - 1: the largest time that fits the ULID time prefix. */
const MAX_TIME = 281_474_976_710_655;

const webCryptoRandom: RandomBytes = (buf) => {
  globalThis.crypto.getRandomValues(buf);
};

function encodeTime(ms: number): number[] {
  const out: number[] = new Array<number>(TIME_CHARS).fill(0);
  let rest = ms;
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    out[i] = rest % BASE;
    rest = Math.floor(rest / BASE);
  }
  return out;
}

function toText(digits: readonly number[]): string {
  let s = '';
  for (const d of digits) s += CROCKFORD.charAt(d);
  return s;
}

/**
 * Monotonic ULID minter. Ids minted in the same millisecond (or after the clock
 * steps backwards) increment the previous random part, so they strictly increase
 * and sort lexicographically in mint order.
 */
export class UlidMinter implements Ids {
  private lastTime = -1;
  private lastRandom: number[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly random: RandomBytes = webCryptoRandom,
  ) {}

  mint<B extends string = string>(): Ulid<B> {
    const now = this.clock.now();
    if (!Number.isInteger(now) || now < 0 || now > MAX_TIME) {
      throw new RangeError('clock value outside the ULID time range');
    }
    let time = Math.max(now, this.lastTime);
    if (time === this.lastTime && this.increment()) {
      return this.build<B>(time);
    }
    if (time === this.lastTime) {
      // The random part overflowed within one millisecond: move to the next one.
      time += 1;
      if (time > MAX_TIME) throw new RangeError('ULID time range exhausted');
    }
    this.lastTime = time;
    this.lastRandom = this.freshRandom();
    return this.build<B>(time);
  }

  private freshRandom(): number[] {
    const bytes = new Uint8Array(RANDOM_CHARS);
    this.random(bytes);
    return Array.from(bytes, (b) => b % BASE);
  }

  /** Add one to the random part. Returns false on overflow. */
  private increment(): boolean {
    for (let i = RANDOM_CHARS - 1; i >= 0; i--) {
      const d = this.lastRandom[i] ?? 0;
      if (d < BASE - 1) {
        this.lastRandom[i] = d + 1;
        return true;
      }
      this.lastRandom[i] = 0;
    }
    return false;
  }

  private build<B extends string>(time: number): Ulid<B> {
    return parseId<B>(toText(encodeTime(time)) + toText(this.lastRandom));
  }
}

const SEQ_PREFIX = '01TEST0000000000000000';
const SEQ_MAX = 9999;

/** Deterministic ids for tests: `01TEST...0001`, `01TEST...0002`, and so on. */
export class SeqIds implements Ids {
  private n = 0;

  mint<B extends string = string>(): Ulid<B> {
    this.n += 1;
    if (this.n > SEQ_MAX) throw new RangeError('SeqIds exhausted');
    return parseId<B>(SEQ_PREFIX + String(this.n).padStart(4, '0'));
  }
}
