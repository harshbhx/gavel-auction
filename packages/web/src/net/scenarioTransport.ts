import type { ClientMessage, ServerMessage } from '../wire';
import type { Scenario, Transport, TransportStatus, Unsubscribe } from './transport';

type Action =
  | {
      readonly at: number;
      readonly order: number;
      readonly kind: 'emit';
      readonly msg: ServerMessage;
    }
  | { readonly at: number; readonly order: number; readonly kind: 'disconnect' };

type Pending =
  | { readonly at: number; readonly kind: 'emit'; readonly msg: ServerMessage }
  | { readonly at: number; readonly kind: 'disconnect' };

export interface Scheduler {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const defaultScheduler: Scheduler = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as number),
};

/**
 * Plays a Scenario with no network (R-WEB-008). Time is controlled: call `advance(ms)`, or
 * `autoplay()` to follow the wall clock. Faults are applied while the schedule is built, so a
 * given scenario always produces the same delivery order.
 */
export class ScenarioTransport implements Transport {
  readonly sent: ClientMessage[] = [];
  private readonly schedule: readonly Action[];
  private readonly expectations: Array<Partial<ClientMessage>>;
  private readonly messageListeners = new Set<(m: ServerMessage) => void>();
  private readonly statusListeners = new Set<(s: TransportStatus) => void>();
  private status: TransportStatus = 'closed';
  private now = 0;
  private cursor = 0;
  private timer: unknown = null;
  private scheduler: Scheduler = defaultScheduler;

  constructor(scenario: Scenario) {
    this.schedule = buildSchedule(scenario);
    this.expectations = scenario.steps.flatMap((s) =>
      s.expectClient === undefined ? [] : [s.expectClient],
    );
  }

  get currentStatus(): TransportStatus {
    return this.status;
  }

  get elapsedMs(): number {
    return this.now;
  }

  connect(): void {
    if (this.status === 'open') return;
    this.setStatus('connecting');
    this.setStatus('open');
    this.flushDue();
  }

  send(msg: ClientMessage): void {
    if (this.status !== 'open') return;
    this.sent.push(msg);
  }

  onMessage(cb: (m: ServerMessage) => void): Unsubscribe {
    this.messageListeners.add(cb);
    return () => {
      this.messageListeners.delete(cb);
    };
  }

  onStatus(cb: (s: TransportStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  close(): void {
    this.stopAutoplay();
    if (this.status !== 'closed') this.setStatus('closed');
  }

  /** Moves the scenario clock forward and delivers everything that falls due. */
  advance(ms: number): void {
    this.now += Math.max(0, ms);
    this.flushDue();
  }

  /** True when every `expectClient` in the scenario matches some message the client sent. */
  expectationsMet(): boolean {
    return this.expectations.every((exp) =>
      this.sent.some((msg) =>
        Object.entries(exp).every(([k, v]) => (msg as unknown as Record<string, unknown>)[k] === v),
      ),
    );
  }

  /** Follows the wall clock. Stops by itself when the scenario ends. */
  autoplay(scheduler: Scheduler = defaultScheduler): void {
    this.stopAutoplay();
    this.scheduler = scheduler;
    this.armNext();
  }

  private armNext(): void {
    const next = this.schedule[this.cursor];
    if (next === undefined) return;
    const wait = Math.max(0, next.at - this.now);
    this.timer = this.scheduler.setTimer(() => {
      this.timer = null;
      this.advance(wait);
      this.armNext();
    }, wait);
  }

  private stopAutoplay(): void {
    if (this.timer !== null) this.scheduler.clearTimer(this.timer);
    this.timer = null;
  }

  private flushDue(): void {
    while (this.cursor < this.schedule.length) {
      const action = this.schedule[this.cursor];
      if (action === undefined || action.at > this.now) break;
      this.cursor += 1;
      if (action.kind === 'disconnect') {
        if (this.status === 'open') this.setStatus('closed');
      } else if (this.status === 'open') {
        this.messageListeners.forEach((cb) => cb(action.msg));
      }
    }
  }

  private setStatus(next: TransportStatus): void {
    this.status = next;
    this.statusListeners.forEach((cb) => cb(next));
  }
}

function buildSchedule(scenario: Scenario): Action[] {
  const actions: Action[] = [];
  let order = 0;
  const push = (a: Pending): void => {
    actions.push({ ...a, order: order++ });
  };
  const steps = scenario.steps;
  const swapped = new Set<number>();

  steps.forEach((step, i) => {
    if (swapped.has(i)) return;
    const { emit, fault } = step;
    if (fault === 'disconnect') {
      push({ at: step.at, kind: 'disconnect' });
      if (emit !== undefined) push({ at: step.at, kind: 'emit', msg: emit });
      return;
    }
    if (emit === undefined || fault === 'drop') return;
    if (fault === 'reorder') {
      const next = steps[i + 1];
      if (next?.emit !== undefined) {
        // Deliver the next message first, then this one, both at the later time.
        push({ at: next.at, kind: 'emit', msg: next.emit });
        push({ at: next.at, kind: 'emit', msg: emit });
        swapped.add(i + 1);
        return;
      }
    }
    if (fault !== undefined && fault.startsWith('delay:')) {
      const ms = Number(fault.slice('delay:'.length));
      push({ at: step.at + (Number.isFinite(ms) ? ms : 0), kind: 'emit', msg: emit });
      return;
    }
    push({ at: step.at, kind: 'emit', msg: emit });
    if (fault === 'dup') push({ at: step.at, kind: 'emit', msg: emit });
  });

  return actions.sort((a, b) => a.at - b.at || a.order - b.order);
}
