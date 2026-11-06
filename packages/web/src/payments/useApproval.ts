import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaymentsMode } from '../config';
import { FakeApprovalAdapter, type FakeAdapterDeps } from './fakeAdapter';
import { PayPalV6Adapter, type PayPalAdapterDeps } from './paypalV6Adapter';
import type { ApprovalResult, ApprovalState, PaymentApprovalPort } from './port';
import {
  clearAllRegistrations,
  clearRegistration,
  loadRegistration,
  saveRegistration,
} from './registrationStore';

interface Attempt {
  clientRegistrationId: string;
  promise: Promise<ApprovalResult> | null;
  state: ApprovalState;
  result: ApprovalResult | null;
}

/**
 * Per room and bidder, outside React, so a remount (back and forward) joins the attempt that is
 * already running or shows the hold that already exists (R-WEB-047).
 */
const attempts = new Map<string, Attempt>();

/** Test helper: forget every attempt. */
export function resetApprovalMemory(): void {
  attempts.clear();
  clearAllRegistrations();
}

/** Test helper: drop the in-memory attempts only, as a page reload does. */
export function resetAttemptMemoryOnly(): void {
  attempts.clear();
}

const keyOf = (roomId: string, bidderId: string): string => `${roomId}:${bidderId}`;

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** VITE_PAYMENTS=fake selects the fake adapter (R-WEB-048); anything else uses PayPal v6. */
export function createApprovalPort(
  mode: PaymentsMode,
  fake: FakeAdapterDeps,
  paypal: Pick<PayPalAdapterDeps, 'apiBase' | 'clientId' | 'token'>,
): PaymentApprovalPort {
  return mode === 'fake' ? new FakeApprovalAdapter(fake) : new PayPalV6Adapter(paypal);
}

/**
 * Return route step for a buyer who approved on PayPal's own page: finishes the hold with the
 * registration id stored when the attempt began, so the server sees the same id as before.
 */
export function completeApprovalReturn(
  adapter: Pick<PayPalV6Adapter, 'completeRedirect'>,
  req: { roomId: string; bidderId: string; orderId: string },
  on: (s: ApprovalState) => void,
): Promise<ApprovalResult> {
  const stored = loadRegistration(req.roomId, req.bidderId);
  if (stored === null) {
    on('error');
    return Promise.resolve({ state: 'error', errorCode: 'registration_missing' });
  }
  if (stored.orderId !== req.orderId) {
    on('error');
    return Promise.resolve({ state: 'error', errorCode: 'order_mismatch' });
  }
  if (stored.holdId === undefined) {
    on('error');
    return Promise.resolve({ state: 'error', errorCode: 'registration_missing' });
  }
  return adapter.completeRedirect(
    stored.holdId,
    req.orderId,
    stored.clientRegistrationId,
    on,
    stored.ceilingCents,
  );
}

export interface UseApprovalOptions {
  port: PaymentApprovalPort;
  roomId: string;
  bidderId: string;
  /** Test seam for the per-attempt id. */
  makeId?: () => string;
}

export interface UseApproval {
  state: ApprovalState;
  result: ApprovalResult | null;
  /** Starts an attempt. Calls while one is running, or after a hold exists, create nothing new. */
  start(ceilingCents: number): Promise<ApprovalResult>;
  cancel(): void;
}

export function useApproval(options: UseApprovalOptions): UseApproval {
  const { port, roomId, bidderId } = options;
  const key = keyOf(roomId, bidderId);
  const makeId = options.makeId ?? newId;
  const existing = attempts.get(key);
  const [state, setState] = useState<ApprovalState>(existing?.state ?? 'idle');
  const [result, setResult] = useState<ApprovalResult | null>(existing?.result ?? null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Join an attempt that was running before this component mounted.
  useEffect(() => {
    const current = attempts.get(key);
    if (current?.promise == null) return;
    setState(current.state);
    void current.promise.then((r) => {
      if (alive.current) {
        setState(r.state);
        setResult(r);
      }
    });
  }, [key]);

  const start = useCallback(
    (ceilingCents: number): Promise<ApprovalResult> => {
      const current = attempts.get(key);
      if (current?.promise != null) return current.promise;
      if (current?.result?.state === 'held') return Promise.resolve(current.result);

      // A declined order is dead on the server, so it needs a new id. Cancelled and error retries
      // reuse it, and so does a reload: the stored id is the one the server already saw.
      const stored = current === undefined ? loadRegistration(roomId, bidderId) : null;
      const retryable =
        current?.result?.errorCode === 'hold_failed' ||
        current?.result?.errorCode === 'hold_timeout';
      // After a reload the order the server already issued for this ceiling is the one to finish,
      // so the buyer is not sent through PayPal's approval again.
      const reloaded =
        stored?.orderId !== undefined &&
        stored.holdId !== undefined &&
        stored.ceilingCents === ceilingCents
          ? { orderId: stored.orderId, holdId: stored.holdId }
          : null;
      const retryOrderId = retryable ? current?.result?.orderId : reloaded?.orderId;
      const retryHoldId = retryable ? current?.result?.holdId : reloaded?.holdId;
      const attempt: Attempt = {
        clientRegistrationId:
          current !== undefined && current.result?.state !== 'declined'
            ? current.clientRegistrationId
            : (stored?.clientRegistrationId ?? makeId()),
        promise: null,
        state: 'preparing',
        result: null,
      };
      attempts.set(key, attempt);
      saveRegistration(roomId, bidderId, {
        clientRegistrationId: attempt.clientRegistrationId,
        ceilingCents,
      });
      const promise = port
        .start(
          {
            roomId,
            bidderId,
            ceilingCents,
            clientRegistrationId: attempt.clientRegistrationId,
            ...(retryOrderId === undefined || retryHoldId === undefined
              ? {}
              : { approvedOrderId: retryOrderId, approvedHoldId: retryHoldId }),
            onOrder: (order) =>
              saveRegistration(roomId, bidderId, {
                clientRegistrationId: attempt.clientRegistrationId,
                orderId: order.orderId,
                holdId: order.holdId,
                ceilingCents,
              }),
          },
          (s) => {
            attempt.state = s;
            if (alive.current) setState(s);
          },
        )
        .then((r) => {
          if (r.state === 'declined') clearRegistration(roomId, bidderId);
          else {
            // An order the attempt did not hand back is finished or released: a reload must not
            // try to confirm it again.
            saveRegistration(roomId, bidderId, {
              clientRegistrationId: attempt.clientRegistrationId,
              ceilingCents,
              ...(r.orderId === undefined ? {} : { orderId: r.orderId }),
              ...(r.orderId === undefined || r.holdId === undefined ? {} : { holdId: r.holdId }),
            });
          }
          attempt.result = r;
          attempt.state = r.state;
          attempt.promise = null;
          if (alive.current) {
            setState(r.state);
            setResult(r);
          }
          return r;
        });
      attempt.promise = promise;
      return promise;
    },
    [key, port, roomId, bidderId, makeId],
  );

  const cancel = useCallback(() => {
    port.cancel();
  }, [port]);

  return { state, result, start, cancel };
}
