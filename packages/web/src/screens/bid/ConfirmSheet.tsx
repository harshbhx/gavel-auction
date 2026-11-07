import { useEffect, useRef, useState } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Sheet } from '../../design/primitives/Sheet';
import type { ConfirmRequestMsg } from '../../wire';
import { formatUsd } from '../../util/money';

export interface ConfirmSheetProps {
  /** A confirm_request addressed to this bidder, or null. */
  request: ConfirmRequestMsg | null;
  /** This bidder's paddle number. */
  paddle: number;
  /** Current price in cents, to note a change since the sheet opened. */
  currentCents: number | null;
  /** Sends one confirm_response. */
  onRespond: (confirmId: string, accept: boolean) => void;
  now?: () => number;
}

/** Bottom sheet asking the bidder to confirm a heard bid; answers once, expires at expiresAt. */
export function ConfirmSheet({
  request,
  paddle,
  currentCents,
  onRespond,
  now = Date.now,
}: ConfirmSheetProps) {
  const [answered, setAnswered] = useState<string | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  const openedAt = useRef<{ id: string; price: number | null } | null>(null);
  const sent = useRef<Set<string>>(new Set());

  const id = request?.confirmId ?? null;
  if (id !== null && openedAt.current?.id !== id) openedAt.current = { id, price: currentCents };

  useEffect(() => {
    if (request === null) return undefined;
    const wait = request.expiresAt - now();
    if (wait <= 0) {
      setExpired(request.confirmId);
      return undefined;
    }
    const timer = setTimeout(() => setExpired(request.confirmId), wait);
    return () => clearTimeout(timer);
  }, [request, now]);

  if (request === null) return null;

  const isExpired = expired === request.confirmId;
  const isAnswered = answered === request.confirmId;
  const opened = openedAt.current?.price ?? null;
  const changed = currentCents !== null && opened !== null && currentCents !== opened;

  const respond = (accept: boolean): void => {
    if (isExpired || sent.current.has(request.confirmId)) return;
    sent.current.add(request.confirmId);
    setAnswered(request.confirmId);
    onRespond(request.confirmId, accept);
  };

  const done = isExpired || isAnswered;
  const title = t('confirm.title', { amount: formatUsd(request.amount), n: paddle });

  return (
    <Sheet open onClose={() => undefined} title={title}>
      <div className="bid-confirm">
        <p className="bid-confirm__title">{title}</p>
        {changed && currentCents !== null && (
          <p role="status">{t('confirm.changed', { amount: formatUsd(currentCents) })}</p>
        )}
        {isExpired && <p role="status">{t('confirm.expired')}</p>}
        {isAnswered && !isExpired && <p role="status">{t('confirm.answered')}</p>}
        <Button size="bid" disabled={done} onClick={() => respond(true)}>
          {t('confirm.yes')}
        </Button>
        <Button size="bid" variant="outline" disabled={done} onClick={() => respond(false)}>
          {t('confirm.no')}
        </Button>
      </div>
    </Sheet>
  );
}
