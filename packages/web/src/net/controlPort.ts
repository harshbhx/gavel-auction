import type { ControlPort } from './transport';

export interface ControlRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type ControlFetch = (
  url: string,
  init: ControlRequestInit,
) => Promise<{ ok: boolean; status: number; text?: () => Promise<string> }>;

export interface ControlPortDeps {
  readonly auctionId: string;
  /** Auctioneer bearer token. Never a bidder session or a screen token. */
  readonly token: string;
  /** Origin prefix, empty for same origin. */
  readonly baseUrl?: string;
  readonly fetch?: ControlFetch;
  /** Idempotency key source: one id per user action. */
  readonly newControlId?: () => string;
  /** Time to wait for one attempt, in milliseconds. */
  readonly timeoutMs?: number;
}

/** How long one control request may take before it is given up on. */
export const CONTROL_TIMEOUT_MS = 5000;

export class ControlError extends Error {
  readonly status: number;
  /** What the server said, when it said anything readable. */
  readonly detail: string | null;
  constructor(status: number, detail: string | null = null) {
    super(`control request failed with status ${status}`);
    this.name = 'ControlError';
    this.status = status;
    this.detail = detail;
  }
}

/** The request got no answer in time, so the server may or may not have applied it. */
export class ControlTimeoutError extends Error {
  constructor() {
    super('control request timed out');
    this.name = 'ControlTimeoutError';
  }
}

let counter = 0;
/**
 * One fresh id per user action. The random part keeps two tabs, or a reloaded page whose counter
 * restarted, from ever minting the same id: the server refuses an id it saw under another action.
 */
function defaultControlId(): string {
  counter += 1;
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `web-${Date.now().toString(36)}-${counter}-${rand}`;
}

function textField(rec: Record<string, unknown>): string | null {
  for (const key of ['message', 'code']) {
    const v = rec[key];
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}

function detailFrom(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null) {
      const rec = body as Record<string, unknown>;
      const err = rec['error'];
      if (typeof err === 'string' && err !== '') return err;
      if (typeof err === 'object' && err !== null) {
        const inner = textField(err as Record<string, unknown>);
        if (inner !== null) return inner;
      }
      const outer = textField(rec);
      if (outer !== null) return outer;
    }
    return null;
  } catch {
    return text.slice(0, 200);
  }
}

async function readDetail(res: { text?: () => Promise<string> }): Promise<string | null> {
  if (res.text === undefined) return null;
  try {
    return detailFrom(await res.text());
  } catch {
    return null;
  }
}

/**
 * ControlPort over `POST /api/auctions/:id/control`. The server echoes every accepted command
 * as an audit_event frame, so this port only reports whether the request was accepted. An attempt
 * that gets no answer is tried once more under the same controlId (the server treats a repeated
 * id as the same command), then reported as ControlTimeoutError.
 */
export function createControlPort(deps: ControlPortDeps): ControlPort {
  const doFetch: ControlFetch =
    deps.fetch ?? ((url, init) => globalThis.fetch(url, init) as Promise<Response>);
  const newId = deps.newControlId ?? defaultControlId;
  const timeoutMs = deps.timeoutMs ?? CONTROL_TIMEOUT_MS;
  const base = deps.baseUrl ?? '';
  const controlUrl = `${base}/api/auctions/${encodeURIComponent(deps.auctionId)}/control`;
  const killUrl = `${base}/api/auctions/${encodeURIComponent(deps.auctionId)}/kill`;

  const attempt = async (url: string, body: string): Promise<void> => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new ControlTimeoutError());
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.token}` },
          body,
          signal: abort.signal,
        }),
        timeout,
      ]);
      if (!res.ok) throw new ControlError(res.status, await readDetail(res));
    } finally {
      clearTimeout(timer);
    }
  };

  const post = async (
    path: string,
    payload: Record<string, unknown>,
    retryOnTimeout: boolean,
  ): Promise<void> => {
    const url = path === 'kill' ? killUrl : controlUrl;
    const body = JSON.stringify({ controlId: newId(), ...payload });
    try {
      await attempt(url, body);
    } catch (err) {
      if (!(err instanceof ControlTimeoutError) || !retryOnTimeout) throw err;
      await attempt(url, body);
    }
  };

  const control = (action: string, args?: Record<string, number>): Promise<void> =>
    post('control', { action, ...(args !== undefined ? { args } : {}) }, true);

  return {
    open: () => control('open'),
    pause: () => control('pause'),
    resume: () => control('resume'),
    extend: (ms) => control('extend', { extraMs: ms }),
    // The expectation travels with the hammer so a late bid is refused, not hammered.
    hammer: (...call) => {
      const expected = call[1];
      // closeNow: the console hammers an open lot, which the server only closes on request.
      return control('hammer', {
        closeNow: 1,
        ...(expected === undefined
          ? {}
          : {
              expectedPriceCents: expected.priceCents,
              expectedLeaderPaddle: expected.leaderPaddle,
              expectedSeq: expected.seq,
            }),
      });
    },
    // The stop route: the server refuses any confirm text other than STOP.
    kill: (confirm) => post('kill', { confirm }, false),
  };
}
