import type { ControlPort } from './transport';

export type ControlFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export interface ControlPortDeps {
  readonly auctionId: string;
  /** Auctioneer bearer token. */
  readonly token: string;
  /** Origin prefix, empty for same origin. */
  readonly baseUrl?: string;
  readonly fetch?: ControlFetch;
  /** Idempotency key source: one id per user action. */
  readonly newControlId?: () => string;
}

export class ControlError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`control request failed with status ${status}`);
    this.name = 'ControlError';
    this.status = status;
  }
}

let counter = 0;
function defaultControlId(): string {
  counter += 1;
  return `web-${Date.now().toString(36)}-${counter}`;
}

/**
 * ControlPort over `POST /api/auctions/:id/control`. The server echoes every accepted command
 * as an audit_event frame, so this port only reports whether the request was accepted.
 * The server has no kill route yet, so `kill` rejects instead of guessing an endpoint.
 */
export function createControlPort(deps: ControlPortDeps): ControlPort {
  const doFetch: ControlFetch =
    deps.fetch ?? ((url, init) => globalThis.fetch(url, init) as Promise<Response>);
  const newId = deps.newControlId ?? defaultControlId;
  const url = `${deps.baseUrl ?? ''}/api/auctions/${encodeURIComponent(deps.auctionId)}/control`;

  const post = async (action: string, args?: Record<string, number>): Promise<void> => {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.token}` },
      body: JSON.stringify({
        controlId: newId(),
        action,
        ...(args !== undefined ? { args } : {}),
      }),
    });
    if (!res.ok) throw new ControlError(res.status);
  };

  return {
    open: () => post('open'),
    pause: () => post('pause'),
    resume: () => post('resume'),
    extend: (ms) => post('extend', { extraMs: ms }),
    hammer: () => post('hammer'),
    kill: () => Promise.reject(new ControlError(404)),
  };
}
