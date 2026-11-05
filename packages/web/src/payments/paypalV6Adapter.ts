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
import {
  ABANDON_HOLD_METHOD,
  ApproveHoldResponse,
  CreateHoldResponse,
  type HoldErrorCode,
} from '@gavel/shared';
import { isHoldErrorCode } from '../copy/errors';

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
  /** How long an order or hold request may take before it is abandoned. Defaults to 15 s. */
  requestTimeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 15_000;

type PostResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; why: 'timeout' | 'aborted' | 'failed'; code?: HoldErrorCode };

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

const APPROVE_HOSTS: readonly string[] = ['www.sandbox.paypal.com', 'sandbox.paypal.com'];

/** The redirect fallback may only go to PayPal's sandbox over https, never to a string the server picked. */
function safeApproveUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    const ok =
      url.protocol === 'https:' &&
      APPROVE_HOSTS.includes(url.hostname) &&
      url.username === '' &&
      url.password === '' &&
      url.port === '';
    return ok ? url.href : null;
  } catch {
    return null;
  }
}

const holdPath = (holdId: string): string => `/api/holds/${encodeURIComponent(holdId)}`;

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

    if (req.approvedOrderId !== undefined && req.approvedHoldId !== undefined) {
      on('confirming');
      return this.confirm(req.approvedHoldId, req.approvedOrderId, finish, req.ceilingCents);
    }

    on('preparing');
    const order = await this.post('/api/holds', {
      auctionId: req.roomId,
      ceilingCents: req.ceilingCents,
    });
    if (!order.ok) {
      if (order.why === 'aborted') return finish('cancelled');
      return finish('error', {
        errorCode: order.code ?? (order.why === 'timeout' ? 'order_timeout' : 'order_failed'),
      });
    }
    const created = CreateHoldResponse.safeParse(order.body);
    if (!created.success) return finish('error', { errorCode: 'order_failed' });
    const { holdId, orderId, clientToken } = created.data;
    const approveUrl = safeApproveUrl(created.data.approveUrl);
    this.abandonUrl = holdPath(holdId);

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
      // Wallet-buyer fallback: approve on PayPal's own page and finish on the return route. The
      // hold stays open for that route, so it is not released here.
      if (approveUrl !== null) {
        this.abandonUrl = null;
        (this.deps.redirect ?? ((url) => globalThis.location.assign(url)))(approveUrl);
        return {
          state: 'awaiting_buyer',
          correlationId,
          errorCode: outcome.code,
          orderId,
          holdId,
        };
      }
      await this.release();
      return finish('error', { errorCode: outcome.code });
    }

    on('confirming');
    return this.confirm(holdId, outcome.orderId, finish, req.ceilingCents);
  }

  /** Return route step: the buyer came back from PayPal's approval page with an order id. */
  async completeRedirect(
    holdId: string,
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
    return this.confirm(holdId, orderId, finish);
  }

  private async confirm(
    holdId: string,
    orderId: string,
    finish: (state: ApprovalState, extra?: Partial<ApprovalResult>) => ApprovalResult,
    expectedCents?: number,
  ): Promise<ApprovalResult> {
    const hold = await this.post(`${holdPath(holdId)}/approve`, { orderId });
    if (!hold.ok) {
      if (hold.why === 'aborted') return finish('cancelled');
      return finish('error', {
        errorCode: hold.code ?? (hold.why === 'timeout' ? 'hold_timeout' : 'hold_failed'),
        orderId,
        holdId,
      });
    }
    const approved = ApproveHoldResponse.safeParse(hold.body);
    if (!approved.success) return finish('error', { errorCode: 'hold_failed' });
    this.abandonUrl = null;
    // The amount the server confirmed must be the one this attempt asked for (WEB-R2-10).
    if (expectedCents !== undefined && approved.data.ceilingCents !== expectedCents) {
      return finish('error', { errorCode: 'hold_mismatch' });
    }
    // The payments service returns the full hold id; only the last 6 characters are shown.
    return finish('held', {
      holdIdSuffix: approved.data.holdId.slice(-6),
      ceilingCents: approved.data.ceilingCents,
    });
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
    let abandoned = false;
    this.abandon = () => {
      abandoned = true;
      settle({ kind: 'cancelled' });
    };
    try {
      const sdk = await (this.deps.loadSdk ?? loadPayPalSdkScript)();
      // A cancel during the load must not open a popup the buyer can no longer close.
      if (abandoned) return { kind: 'cancelled' };
      const instance = await sdk.createInstance({
        clientId: this.deps.clientId,
        ...(clientToken === undefined ? {} : { clientToken }),
      });
      if (abandoned) return { kind: 'cancelled' };
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
      if (!res.ok) {
        // Keep the payments error code of a non-2xx body so the UI can show its copy.
        const errBody = await Promise.race([res.json().catch(() => null), aborted]);
        if (errBody === 'abort') return { ok: false, why: timedOut ? 'timeout' : 'aborted' };
        const code = isRecord(errBody) ? errBody['error'] : undefined;
        return isHoldErrorCode(code)
          ? { ok: false, why: 'failed', code }
          : { ok: false, why: 'failed' };
      }
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
