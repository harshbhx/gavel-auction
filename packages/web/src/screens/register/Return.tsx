import { useEffect, useRef, useState } from 'react';

import { WideAside } from '../WideAside';
import type { ApprovalResult, ApprovalState } from '../../payments/port';
import { completeApprovalReturn } from '../../payments/useApproval';
import '../flows.css';
import { Approve } from './Approve';

export interface ReturnProps {
  adapter: Parameters<typeof completeApprovalReturn>[0];
  roomId: string;
  bidderId: string;
  /** The order token PayPal put on the return URL; empty when it is missing. */
  orderId: string;
  /** Ceiling shown if the server does not echo one. */
  ceilingCents: number;
  onBackToCeiling: () => void;
  onContinue: () => void;
}

/** Return route for a buyer who approved on PayPal's own page (R-WEB-046). Runs once. */
export function Return({
  adapter,
  roomId,
  bidderId,
  orderId,
  ceilingCents,
  onBackToCeiling,
  onContinue,
}: ReturnProps) {
  const [state, setState] = useState<ApprovalState>(orderId === '' ? 'error' : 'confirming');
  const [result, setResult] = useState<ApprovalResult | null>(
    orderId === '' ? { state: 'error', errorCode: 'registration_missing' } : null,
  );
  const started = useRef(false);

  const run = (): void => {
    void completeApprovalReturn(adapter, { roomId, bidderId, orderId }, setState).then(setResult);
  };

  useEffect(() => {
    if (started.current || orderId === '') return;
    started.current = true;
    void completeApprovalReturn(adapter, { roomId, bidderId, orderId }, setState).then(setResult);
  }, [adapter, roomId, bidderId, orderId]);

  return (
    <main className="gv-flow" data-route="return">
      <Approve
        state={state}
        result={result}
        ceilingCents={ceilingCents}
        onBackToCeiling={onBackToCeiling}
        onRetry={() => {
          setState('confirming');
          run();
        }}
        onContinue={onContinue}
      />
      <WideAside />
    </main>
  );
}
