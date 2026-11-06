import { ApproveHoldResponse, CreateHoldResponse } from '@gavel/shared';
import type { ApprovalRequest, ApprovalResult, ApprovalState, PaymentApprovalPort } from './port';

export type FakeFaultMode = 'ok' | 'cancel' | 'decline' | 'slow' | 'error';

export type FetchLike = (
  input: string,
  init: {
    method: 'POST' | 'DELETE';
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FakeAdapterDeps {
  apiBase: string;
  /** Session bearer token sent on every hold request. */
  token?: string;
  mode?: FakeFaultMode;
  fetch?: FetchLike;
  /** Wait used for the buyer step. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** How long the `slow` mode keeps the buyer waiting. */
  slowMs?: number;
}

const BUYER_MS = 400;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Fake approval adapter: same port as the real one, no PayPal calls (R-WEB-048).
 * State sequences (SPEC 6.2):
 *   ok       preparing, awaiting_buyer, confirming, held
 *   slow     same as ok, with a long wait in awaiting_buyer
 *   cancel   preparing, awaiting_buyer, cancelled
 *   decline  preparing, awaiting_buyer, declined
 *   error    preparing, error (the order could not be created)
 */
export class FakeApprovalAdapter implements PaymentApprovalPort {
  private readonly deps: FakeAdapterDeps;
  private mode: FakeFaultMode;
  private abandon: (() => void) | null = null;

  constructor(deps: FakeAdapterDeps) {
    this.deps = deps;
    this.mode = deps.mode ?? 'ok';
  }

  setMode(mode: FakeFaultMode): void {
    this.mode = mode;
  }

  cancel(): void {
    this.abandon?.();
  }

  async start(req: ApprovalRequest, on: (s: ApprovalState) => void): Promise<ApprovalResult> {
    const correlationId = `fake-${req.clientRegistrationId.slice(0, 8)}`;
    const finish = (state: ApprovalState, extra: Partial<ApprovalResult> = {}): ApprovalResult => {
      on(state);
      return { state, correlationId, ...extra };
    };

    on('preparing');
    const order = await this.post('/api/holds', {
      auctionId: req.roomId,
      ceilingCents: req.ceilingCents,
    });
    if (this.mode === 'error' || order === null) {
      return finish('error', { errorCode: order === null ? 'order_failed' : 'fake_error' });
    }
    const created = CreateHoldResponse.safeParse(order);
    if (!created.success) return finish('error', { errorCode: 'order_failed' });
    const { holdId, orderId } = created.data;
    req.onOrder?.({ orderId, holdId });

    on('awaiting_buyer');
    const buyerWait = this.mode === 'slow' ? (this.deps.slowMs ?? 3000) : BUYER_MS;
    const abandoned = await this.waitForBuyer(buyerWait);
    if (abandoned || this.mode === 'cancel') return finish('cancelled');
    if (this.mode === 'decline') return finish('declined', { errorCode: 'payer_declined' });

    on('confirming');
    const hold = await this.post(`/api/holds/${encodeURIComponent(holdId)}/approve`, { orderId });
    const approved = ApproveHoldResponse.safeParse(hold);
    if (!approved.success) return finish('error', { errorCode: 'hold_failed' });
    return finish('held', { holdIdSuffix: approved.data.holdId.slice(-6) });
  }

  /** Resolves true when the attempt was abandoned during the wait. */
  private waitForBuyer(ms: number): Promise<boolean> {
    const sleep =
      this.deps.sleep ?? ((n: number) => new Promise<void>((resolve) => setTimeout(resolve, n)));
    return new Promise<boolean>((resolve) => {
      let settled = false;
      this.abandon = () => {
        if (!settled) {
          settled = true;
          resolve(true);
        }
      };
      void sleep(ms).then(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
    }).finally(() => {
      this.abandon = null;
    });
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const doFetch: FetchLike = this.deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
    try {
      const res = await doFetch(`${this.deps.apiBase}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.deps.token === undefined ? {} : { authorization: `Bearer ${this.deps.token}` }),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return isRecord(json) ? json : null;
    } catch {
      return null;
    }
  }
}
