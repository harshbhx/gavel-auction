// The only file that knows about the PayPal JS SDK v6 (R-WEB-043, T-WEB-022).
//
// Every SDK call below is UNVERIFIED until gate G2 is run against the sandbox: the instance
// creation, session type, presentation mode and the onApprove / onCancel / onError payloads are
// written against the typed internal interface `PayPalSdkV6`, so only this file changes if the
// real SDK differs. Manual real-SDK checklist (record the outcome in docs/GATES.md under G2):
//   1. Wallet buyer, intent AUTHORIZE: popup opens, approval returns an order id, hold is created.
//   2. Card or guest buyer: same flow and the hold is created.
//   3. Buyer closes the popup: the port reports `cancelled` and no hold exists.
//   4. Declined instrument: the port reports `declined` with a human message.
//   5. Popup blocked: the port reports an error and the unapproved hold is dropped.
import type { ApprovalRequest, ApprovalResult, ApprovalState, PaymentApprovalPort } from './port';
import type { FetchLike } from './fakeAdapter';
import { ABANDON_HOLD_METHOD, ApproveHoldResponse, CreateHoldResponse } from '@gavel/shared';

/** What this adapter needs from the SDK. UNVERIFIED (gate G2). */
export interface PayPalSessionV6 {
  start(
    options: { presentationMode: 'popup' | 'auto' },
    order: Promise<{ orderId: string }>,
  ): Promise<void>;
  cancel(): void;
}

export interface PayPalSessionCallbacks {
  onApprove(data: { orderId: string }): void;
  onCancel(): void;
  onError(error: { code?: string }): void;
}

export interface PayPalInstanceV6 {
  createOneTimePaymentSession(callbacks: PayPalSessionCallbacks): PayPalSessionV6;
}

export interface PayPalSdkV6 {
  createInstance(options: { clientId: string; clientToken?: string }): Promise<PayPalInstanceV6>;
}

export type SdkLoader = () => Promise<PayPalSdkV6>;

/**
 * The sandbox SDK host. This app is sandbox only (R-QA-038), so the live host must never be
 * loaded; a test pins this constant to the sandbox host.
 */
export const PAYPAL_SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core';

let sdkLoad: Promise<PayPalSdkV6> | null = null;

/** Test helper: forget the cached load. */
export function resetPayPalSdkLoad(): void {
  sdkLoad = null;
}

function readGlobalSdk(): PayPalSdkV6 | undefined {
  const candidate = (globalThis as unknown as { paypal?: unknown }).paypal;
  const create = (candidate as { createInstance?: unknown } | undefined)?.createInstance;
  return typeof create === 'function' ? (candidate as PayPalSdkV6) : undefined;
}

/**
 * Injects the SDK script once and resolves with the global it defines. Calls made while the
 * script is loading share one promise, so a double click or a retry never adds a second tag. A
 * failed load removes its tag and clears the promise, so the next call starts clean.
 */
export function loadPayPalSdkScript(): Promise<PayPalSdkV6> {
  const existing = readGlobalSdk();
  if (existing !== undefined) return Promise.resolve(existing);
  if (sdkLoad !== null) return sdkLoad;
  sdkLoad = new Promise<PayPalSdkV6>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = (code: string): void => {
      script.remove();
      sdkLoad = null;
      reject(new Error(code));
    };
    script.src = PAYPAL_SDK_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => {
      // The vendor URL is not versioned, so a fixed integrity hash is not possible; check the
      // shape of what it defined instead of trusting any global named `paypal`.
      const sdk = readGlobalSdk();
      if (sdk === undefined) fail('paypal_sdk_missing');
      else resolve(sdk);
    };
    script.onerror = () => fail('paypal_sdk_load_failed');
    document.head.appendChild(script);
  });
  return sdkLoad;
}

export interface PayPalAdapterDeps {
  apiBase: string;
  clientId: string;
  loadSdk?: SdkLoader;
  fetch?: FetchLike;
  /** How long an order or hold request may take before it is abandoned. Defaults to 15 s. */
  requestTimeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 15_000;

type PostResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; why: 'timeout' | 'aborted' | 'failed' };

type Outcome =
  | { kind: 'approved'; orderId: string }
  | { kind: 'mismatch' }
  | { kind: 'cancelled' }
  | { kind: 'declined'; code: string }
  | { kind: 'failed'; code: string };

/** Codes the SDK is expected to use for a refused instrument. UNVERIFIED (gate G2). */
const DECLINE_CODES: readonly string[] = ['INSTRUMENT_DECLINED', 'PAYER_ACTION_DECLINED'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export class PayPalV6Adapter implements PaymentApprovalPort {
  private session: PayPalSessionV6 | null = null;
  private abandon: (() => void) | null = null;
  private abandonUrl: string | null = null;
  private readonly inFlight = new Set<AbortController>();

  constructor(private readonly deps: PayPalAdapterDeps) {}

  cancel(): void {
    for (const c of this.inFlight) c.abort();
    this.abandon?.();
    this.session?.cancel();
  }

  async start(req: ApprovalRequest, on: (s: ApprovalState) => void): Promise<ApprovalResult> {
    const correlationId = `pp-${req.clientRegistrationId.slice(0, 8)}`;
    const finish = (state: ApprovalState, extra: Partial<ApprovalResult> = {}): ApprovalResult => {
      on(state);
      return { state, correlationId, ...extra };
    };
    on('preparing');
    const order = await this.post('/api/holds', {
      auctionId: req.roomId,
      ceilingCents: req.ceilingCents,
    });
    if (!order.ok) {
      if (order.why === 'aborted') return finish('cancelled');
      return finish('error', {
        errorCode: order.why === 'timeout' ? 'order_timeout' : 'order_failed',
      });
    }
    const created = CreateHoldResponse.safeParse(order.body);
    if (!created.success) return finish('error', { errorCode: 'order_failed' });
    const { holdId, orderId, clientToken } = created.data;
    this.abandonUrl = `/api/holds/${encodeURIComponent(holdId)}`;

    on('awaiting_buyer');
    const outcome = await this.approve(orderId, clientToken);
    if (outcome.kind === 'cancelled') {
      await this.release();
      return finish('cancelled');
    }
    if (outcome.kind === 'mismatch') {
      await this.release();
      return finish('error', { errorCode: 'order_mismatch' });
    }
    if (outcome.kind === 'declined') {
      await this.release();
      return finish('declined', { errorCode: outcome.code });
    }
    if (outcome.kind === 'failed') {
      await this.release();
      return finish('error', { errorCode: outcome.code });
    }

    on('confirming');
    const hold = await this.post(`/api/holds/${encodeURIComponent(holdId)}/approve`, {
      orderId: outcome.orderId,
    });
    if (!hold.ok) {
      if (hold.why === 'aborted') return finish('cancelled');
      return finish('error', {
        errorCode: hold.why === 'timeout' ? 'hold_timeout' : 'hold_failed',
      });
    }
    const approved = ApproveHoldResponse.safeParse(hold.body);
    if (!approved.success) return finish('error', { errorCode: 'hold_failed' });
    this.abandonUrl = null;
    // The payments service returns the full hold id; only the last 6 characters are shown.
    return finish('held', { holdIdSuffix: approved.data.holdId.slice(-6) });
  }

  /** Tells the payments service the buyer walked away, so the unapproved hold is dropped. */
  private async release(): Promise<void> {
    const url = this.abandonUrl;
    this.abandonUrl = null;
    if (url === null) return;
    const doFetch: FetchLike = this.deps.fetch ?? ((u, init) => globalThis.fetch(u, init));
    try {
      await doFetch(`${this.deps.apiBase}${url}`, {
        method: ABANDON_HOLD_METHOD,
        headers: {},
      });
    } catch {
      // Best effort: the service expires an unapproved hold on its own.
    }
  }

  /** Loads the SDK now (not at page load) and runs one approval session. */
  private async approve(orderId: string, clientToken: string | undefined): Promise<Outcome> {
    let settle: (o: Outcome) => void = () => {};
    const done = new Promise<Outcome>((resolve) => {
      settle = resolve;
    });
    this.abandon = () => settle({ kind: 'cancelled' });
    try {
      const sdk = await (this.deps.loadSdk ?? loadPayPalSdkScript)();
      const instance = await sdk.createInstance({
        clientId: this.deps.clientId,
        ...(clientToken === undefined ? {} : { clientToken }),
      });
      const session = instance.createOneTimePaymentSession({
        // Only confirm the order this attempt created, never one the SDK hands back unasked.
        onApprove: (data) =>
          settle(data.orderId === orderId ? { kind: 'approved', orderId } : { kind: 'mismatch' }),
        onCancel: () => settle({ kind: 'cancelled' }),
        onError: (error) => {
          const code = error.code ?? 'paypal_error';
          settle(
            DECLINE_CODES.includes(code) ? { kind: 'declined', code } : { kind: 'failed', code },
          );
        },
      });
      this.session = session;
      session.start({ presentationMode: 'popup' }, Promise.resolve({ orderId })).catch(() => {
        settle({ kind: 'failed', code: 'popup_failed' });
      });
      return await done;
    } catch {
      return { kind: 'failed', code: 'sdk_failed' };
    } finally {
      this.session = null;
      this.abandon = null;
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<PostResult> {
    const doFetch: FetchLike = this.deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const controller = new AbortController();
    this.inFlight.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
    // Resolves when the request is abandoned, even if the transport never answers.
    const aborted = new Promise<'abort'>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve('abort'));
    });
    try {
      const res = await Promise.race([
        doFetch(`${this.deps.apiBase}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        aborted,
      ]);
      if (res === 'abort') return { ok: false, why: timedOut ? 'timeout' : 'aborted' };
      if (!res.ok) return { ok: false, why: 'failed' };
      const json = await Promise.race([res.json(), aborted]);
      if (json === 'abort') return { ok: false, why: timedOut ? 'timeout' : 'aborted' };
      return isRecord(json) ? { ok: true, body: json } : { ok: false, why: 'failed' };
    } catch {
      if (controller.signal.aborted) return { ok: false, why: timedOut ? 'timeout' : 'aborted' };
      return { ok: false, why: 'failed' };
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(controller);
    }
  }
}
