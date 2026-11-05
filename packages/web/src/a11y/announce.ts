// Live-region announcer core (SPEC-web 8.13, R-WEB-110). No React here, so it is testable with fake timers.

export type AnnounceKind = 'polite' | 'assertive';

/**
 * Message keys the app may announce. Partial transcripts have no key, so they cannot be
 * announced (type level); the runtime check below rejects them too.
 */
export type AnnounceKey =
  | 'price'
  | 'outbid'
  | 'stop'
  | 'bid_rejected'
  | 'hold_failure'
  | 'offline'
  | 'summary'
  | 'ladder';

export interface AnnouncerState {
  readonly polite: string;
  readonly assertive: string;
  /** Bumped on every publish so an identical message still mutates the DOM. */
  readonly politeSeq: number;
  readonly assertiveSeq: number;
}

export interface AnnouncerDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface AnnouncerOptions extends Partial<AnnouncerDeps> {
  /** Minimum gap between polite announcements. */
  gapMs?: number;
  /** Longest polite backlog. The oldest entry is dropped when it overflows. */
  maxQueue?: number;
  /** How long an identical assertive message is suppressed. */
  assertiveDedupeMs?: number;
}

export interface AnnouncerCore {
  /** Returns false when the message is rejected (empty, partial transcript) or dropped as a duplicate. */
  announce(kind: AnnounceKind, text: string, key?: AnnounceKey): boolean;
  getState(): AnnouncerState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface Queued {
  readonly text: string;
  readonly key: string | undefined;
}

const PARTIAL = /partial/i;

export function createAnnouncerCore(options: AnnouncerOptions = {}): AnnouncerCore {
  const now = options.now ?? ((): number => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms): unknown => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h): void => clearTimeout(h as number));
  const gapMs = options.gapMs ?? 2000;
  const maxQueue = options.maxQueue ?? 3;
  const dedupeMs = options.assertiveDedupeMs ?? 5000;

  let state: AnnouncerState = { polite: '', assertive: '', politeSeq: 0, assertiveSeq: 0 };
  let queue: Queued[] = [];
  let lastPoliteAt: number | null = null;
  let lastAssertive: { text: string; at: number } | null = null;
  let timer: unknown = null;
  const listeners = new Set<() => void>();

  const publish = (next: AnnouncerState): void => {
    state = next;
    listeners.forEach((l) => l());
  };

  const drain = (): void => {
    timer = null;
    const head = queue.shift();
    if (head === undefined) return;
    lastPoliteAt = now();
    publish({ ...state, polite: head.text, politeSeq: state.politeSeq + 1 });
    schedule();
  };

  const schedule = (): void => {
    if (timer !== null || queue.length === 0) return;
    const wait = lastPoliteAt === null ? 0 : Math.max(0, lastPoliteAt + gapMs - now());
    timer = setTimer(drain, wait);
  };

  const announcePolite = (text: string, key: string | undefined): boolean => {
    const lastQueued = queue[queue.length - 1];
    if (queue.length === 0 && state.polite === text && key === undefined) return false;
    if (lastQueued !== undefined && lastQueued.text === text) return false;
    const existing = key === undefined ? -1 : queue.findIndex((q) => q.key === key);
    if (existing >= 0) {
      // Merge: only the latest message with this key is announced.
      queue = queue.map((q, i) => (i === existing ? { text, key } : q));
    } else {
      queue = [...queue, { text, key }];
      if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
    }
    if (timer === null) {
      const idle = lastPoliteAt === null || now() - lastPoliteAt >= gapMs;
      if (idle) drain();
      else schedule();
    }
    return true;
  };

  const announceAssertive = (text: string): boolean => {
    const t = now();
    if (lastAssertive !== null && lastAssertive.text === text && t - lastAssertive.at < dedupeMs) {
      return false;
    }
    lastAssertive = { text, at: t };
    publish({ ...state, assertive: text, assertiveSeq: state.assertiveSeq + 1 });
    return true;
  };

  return {
    announce(kind, text, key) {
      if (text.trim() === '') return false;
      if (key !== undefined && PARTIAL.test(key)) return false;
      return kind === 'assertive' ? announceAssertive(text) : announcePolite(text, key);
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      queue = [];
      listeners.clear();
    },
  };
}

/** The app-wide announcer. Components call `announce`; the single `Announcer` component renders it. */
export const appAnnouncer: AnnouncerCore = createAnnouncerCore();

export function announce(kind: AnnounceKind, text: string, key?: AnnounceKey): boolean {
  return appAnnouncer.announce(kind, text, key);
}
