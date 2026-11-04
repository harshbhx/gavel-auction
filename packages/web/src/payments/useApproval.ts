import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaymentsMode } from '../config';
import { FakeApprovalAdapter, type FakeAdapterDeps } from './fakeAdapter';
import type { ApprovalResult, ApprovalState, PaymentApprovalPort } from './port';

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
}

const keyOf = (roomId: string, bidderId: string): string => `${roomId}:${bidderId}`;

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** The real PayPal adapter is not built yet (gate G2). Until then it reports an error state. */
class UnavailablePayPalAdapter implements PaymentApprovalPort {
  start(_req: unknown, on: (s: ApprovalState) => void): Promise<ApprovalResult> {
    on('preparing');
    on('error');
    return Promise.resolve({ state: 'error', errorCode: 'paypal_adapter_unavailable' });
  }
  cancel(): void {}
}

/** VITE_PAYMENTS=fake selects the fake adapter (R-WEB-048). */
export function createApprovalPort(mode: PaymentsMode, fake: FakeAdapterDeps): PaymentApprovalPort {
  return mode === 'fake' ? new FakeApprovalAdapter(fake) : new UnavailablePayPalAdapter();
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

      // A declined order is dead on the server, so it needs a new id. Cancelled and error retries reuse it.
      const attempt: Attempt = {
        clientRegistrationId:
          current !== undefined && current.result?.state !== 'declined'
            ? current.clientRegistrationId
            : makeId(),
        promise: null,
        state: 'preparing',
        result: null,
      };
      attempts.set(key, attempt);
      const promise = port
        .start(
          { roomId, bidderId, ceilingCents, clientRegistrationId: attempt.clientRegistrationId },
          (s) => {
            attempt.state = s;
            if (alive.current) setState(s);
          },
        )
        .then((r) => {
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
