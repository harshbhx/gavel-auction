import { DeepgramStt, type DeepgramSttOptions } from './deepgram.js';

/** Words the auction listens for (R-VOX-015). Passed as keyterms through start(). */
export const DEFAULT_KEYTERMS: readonly string[] = [
  'paddle',
  'bidder',
  'hundred',
  'thousand',
  'grand',
  'bucks',
  'dollars',
];

/**
 * Nova-3 keyterm query parameter name. UNVERIFIED until gate G5; override with `keytermParam`.
 * The G5 run compares keyterms on and off (useKeyterms) and smart_format on and off (a
 * `params.smart_format` entry in the config), neither of which needs a code edit.
 */
export const DEFAULT_KEYTERM_PARAM = 'keyterm';

/** One repeated query pair per term; nothing when keyterms are off. Blank and repeated terms are skipped. */
export function keytermPairs(
  terms: readonly string[],
  enabled: boolean,
  param: string = DEFAULT_KEYTERM_PARAM,
): Array<readonly [string, string]> {
  if (!enabled) return [];
  const seen = new Set<string>();
  const out: Array<readonly [string, string]> = [];
  for (const raw of terms) {
    const t = raw.trim();
    if (t === '' || seen.has(t)) continue;
    seen.add(t);
    out.push([param, t]);
  }
  return out;
}

export interface ReconnectPolicy {
  /** Delay before each attempt in order; the list length is the attempt limit per outage. */
  delaysMs: readonly number[];
}

/** R-VOX-020: 250, 500, 1000 ms and at most 3 attempts per outage. */
export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = { delaysMs: [250, 500, 1000] };

/** Attempt counter for one outage; `reset` runs when a connection succeeds. */
export class ReconnectTracker {
  private used = 0;

  constructor(private readonly policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY) {}

  get attempts(): number {
    return this.used;
  }

  /** Delay for the next attempt, or null when the outage has used them all. */
  next(): number | null {
    const delay = this.policy.delaysMs[this.used];
    if (delay === undefined) return null;
    this.used += 1;
    return delay;
  }

  reset(): void {
    this.used = 0;
  }
}

export interface ReconnectingDeepgramOptions extends DeepgramSttOptions {
  /** Send the start() keyterms as keyterm params (default true). */
  useKeyterms?: boolean;
  keytermParam?: string;
  reconnectPolicy?: ReconnectPolicy;
}

/** DeepgramStt with keyterms and automatic reconnect after an unexpected close (R-VOX-015, R-VOX-020). */
export class ReconnectingDeepgramStt extends DeepgramStt {
  private readonly useKeyterms: boolean;
  private readonly keytermParam: string;
  private readonly tracker: ReconnectTracker;
  private cancelWait: (() => void) | null = null;

  constructor(opts: ReconnectingDeepgramOptions) {
    super(opts);
    this.useKeyterms = opts.useKeyterms ?? true;
    this.keytermParam = opts.keytermParam ?? DEFAULT_KEYTERM_PARAM;
    this.tracker = new ReconnectTracker(opts.reconnectPolicy);
  }

  override async stop(): Promise<void> {
    this.cancelWait?.();
    this.cancelWait = null;
    await super.stop();
  }

  protected override extraParams(): ReadonlyArray<readonly [string, string]> {
    return keytermPairs(this.startOpts.keyterms, this.useKeyterms, this.keytermParam);
  }

  protected override onUnexpectedClose(code: number): void {
    // Bad credentials never recover by retrying.
    if (code === 1008 || code === 4001 || code === 4003) {
      super.onUnexpectedClose(code);
      return;
    }
    this.scheduleAttempt();
  }

  private scheduleAttempt(): void {
    if (this.isEnded) return;
    const delay = this.tracker.next();
    if (delay === null) {
      this.finish({ type: 'error', code: 'closed', retryable: false });
      return;
    }
    this.emit({ type: 'state', state: 'reconnecting' });
    this.cancelWait = this.scheduler.after(() => {
      this.cancelWait = null;
      void this.connect().then((ok) => {
        if (this.isEnded) return;
        if (ok) this.tracker.reset();
        else this.scheduleAttempt();
      });
    }, delay);
  }
}
