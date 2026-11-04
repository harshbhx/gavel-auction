// The only file that knows about the PayPal JS SDK v6 (R-WEB-043, T-WEB-022).
//
// Every SDK call below is UNVERIFIED until gate G2 is run against the sandbox: the instance
// creation, session type, presentation mode and the onApprove / onCancel / onError payloads are
// written against the typed internal interface `PayPalSdkV6`, so only this file changes if the
// real SDK differs. Manual real-SDK checklist (record the outcome in docs/GATES.md under G2):
//   1. Wallet buyer, intent AUTHORIZE: popup opens, approval returns an order id, hold is created.
//   2. Card or guest buyer: same flow, or the fallback redirect is used and the hold is created.
//   3. Buyer closes the popup: the port reports `cancelled` and no hold exists.
//   4. Declined instrument: the port reports `declined` with a human message.
//   5. Popup blocked: the redirect approval opens in this tab and the return route completes the hold.
import type { ApprovalRequest, ApprovalResult, ApprovalState, PaymentApprovalPort } from './port';
import type { FetchLike } from './fakeAdapter';

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
  /** Fallback: sends this tab to PayPal's approval page. Defaults to location.assign. */
  redirect?: (url: string) => void;
}

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

  constructor(private readonly deps: PayPalAdapterDeps) {}

  cancel(): void {
    this.abandon?.();
    this.session?.cancel();
  }

  async start(req: ApprovalRequest, on: (s: ApprovalState) => void): Promise<ApprovalResult> {
    const correlationId = `pp-${req.clientRegistrationId.slice(0, 8)}`;
    const finish = (state: ApprovalState, extra: Partial<ApprovalResult> = {}): ApprovalResult => {
      on(state);
      return { state, correlationId, ...extra };
    };
    const roomPath = `/api/rooms/${encodeURIComponent(req.roomId)}`;

    on('preparing');
    const order = await this.post(`${roomPath}/orders`, {
      bidderId: req.bidderId,
      ceilingCents: req.ceilingCents,
      clientRegistrationId: req.clientRegistrationId,
    });
    const orderId = order?.['orderId'];
    if (order === null || typeof orderId !== 'string') {
      return finish('error', { errorCode: 'order_failed' });
    }
    const clientToken = typeof order['clientToken'] === 'string' ? order['clientToken'] : undefined;
    const approveUrl = typeof order['approveUrl'] === 'string' ? order['approveUrl'] : null;

    on('awaiting_buyer');
    const outcome = await this.approve(orderId, clientToken);
    if (outcome.kind === 'cancelled') return finish('cancelled');
    if (outcome.kind === 'mismatch') return finish('error', { errorCode: 'order_mismatch' });
    if (outcome.kind === 'declined') return finish('declined', { errorCode: outcome.code });
    if (outcome.kind === 'failed') {
      // Wallet-buyer fallback: approve on PayPal's own page and finish on the return route.
      if (approveUrl !== null) {
        (this.deps.redirect ?? ((url) => globalThis.location.assign(url)))(approveUrl);
        return { state: 'awaiting_buyer', correlationId, errorCode: outcome.code };
      }
      return finish('error', { errorCode: outcome.code });
    }

    on('confirming');
    return this.confirm(roomPath, outcome.orderId, req.clientRegistrationId, finish);
  }

  /** Return route step: the buyer came back from PayPal's approval page with an order id. */
  async completeRedirect(
    roomId: string,
    orderId: string,
    clientRegistrationId: string,
    on: (s: ApprovalState) => void,
  ): Promise<ApprovalResult> {
    const correlationId = `pp-${clientRegistrationId.slice(0, 8)}`;
    const finish = (state: ApprovalState, extra: Partial<ApprovalResult> = {}): ApprovalResult => {
      on(state);
      return { state, correlationId, ...extra };
    };
    on('confirming');
    return this.confirm(
      `/api/rooms/${encodeURIComponent(roomId)}`,
      orderId,
      clientRegistrationId,
      finish,
    );
  }

  private async confirm(
    roomPath: string,
    orderId: string,
    clientRegistrationId: string,
    finish: (state: ApprovalState, extra?: Partial<ApprovalResult>) => ApprovalResult,
  ): Promise<ApprovalResult> {
    const hold = await this.post(`${roomPath}/holds`, { orderId, clientRegistrationId });
    const suffix = hold?.['holdIdSuffix'];
    if (hold === null || typeof suffix !== 'string') {
      return finish('error', { errorCode: 'hold_failed' });
    }
    return finish('held', { holdIdSuffix: suffix });
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

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const doFetch: FetchLike = this.deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
    try {
      const res = await doFetch(`${this.deps.apiBase}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
