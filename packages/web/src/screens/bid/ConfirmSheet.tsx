import { useEffect, useRef, useState } from 'react';

import { announce } from '../../a11y/announce';

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
  /** Drops the request from the queue (answered, expired, closed or timed out). */
  onDismiss?: (confirmId: string) => void;
  /** Hard client timeout from first sight, in ms. Defaults to the server TTL plus a grace. */
  hardTimeoutMs?: number;
  /** How long the expired notice stays before the sheet closes itself, in ms. */
  expiredLingerMs?: number;
}

/** Mirrors the server's confirm TTL (20 s). */
export const CONFIRM_SERVER_TTL_MS = 20_000;
export const CONFIRM_GRACE_MS = 2_000;
export const CONFIRM_EXPIRED_LINGER_MS = 3_000;

/**
 * Bottom sheet asking the bidder to confirm a heard bid. An answer closes it at once; an expired,
 * stale or forgotten question closes itself, so it can never stay on screen with dead buttons.
 */
export function ConfirmSheet({
  request,
  paddle,
  currentCents,
  onRespond,
  now = Date.now,
  onDismiss,
  hardTimeoutMs = CONFIRM_SERVER_TTL_MS + CONFIRM_GRACE_MS,
  expiredLingerMs = CONFIRM_EXPIRED_LINGER_MS,
}: ConfirmSheetProps) {
  const [expired, setExpired] = useState<string | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const openedAt = useRef<{ id: string; price: number | null } | null>(null);
  const sent = useRef<Set<string>>(new Set());
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const nowRef = useRef(now);
  nowRef.current = now;

  const [tick, setTick] = useState(0);
  const span = useRef<{ id: string; total: number } | null>(null);

  const id = request?.confirmId ?? null;
  const expiresAt = request?.expiresAt ?? null;
  if (id !== null && request !== null && span.current?.id !== id) {
    span.current = { id, total: Math.max(1, request.expiresAt - now()) };
  }
  if (id !== null && openedAt.current?.id !== id) openedAt.current = { id, price: currentCents };

  const dismiss = (confirmId: string): void => {
    setClosed((prev) => new Set(prev).add(confirmId));
    dismissRef.current?.(confirmId);
  };
  const dismissStable = useRef(dismiss);
  dismissStable.current = dismiss;

  // Expiry by the server clock, and a hard timeout that does not depend on any clock agreeing.
  useEffect(() => {
    if (id === null || expiresAt === null) return undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = expiresAt - nowRef.current();
    if (wait <= 0) {
      // Stale on arrival: say so once and drop it.
      announce('polite', t('confirm.expired'));
      dismissStable.current(id);
      return undefined;
    }
    timers.push(setTimeout(() => setExpired(id), wait));
    timers.push(setTimeout(() => dismissStable.current(id), hardTimeoutMs));
    return () => timers.forEach(clearTimeout);
  }, [id, expiresAt, hardTimeoutMs]);

  // Redraw the countdown a few times a second while the question is open.
  useEffect(() => {
    if (id === null || expired === id) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [id, expired]);

  // Once expired, the notice lingers briefly and then the sheet closes itself.
  useEffect(() => {
    if (id === null || expired !== id) return undefined;
    announce('polite', t('confirm.expired'));
    const timer = setTimeout(() => dismissStable.current(id), expiredLingerMs);
    return () => clearTimeout(timer);
  }, [id, expired, expiredLingerMs]);

  if (request === null || closed.has(request.confirmId)) return null;

  const isExpired = expired === request.confirmId;
  const opened = openedAt.current?.price ?? null;
  const changed = currentCents !== null && opened !== null && currentCents !== opened;

  const respond = (accept: boolean): void => {
    if (isExpired || sent.current.has(request.confirmId)) return;
    sent.current.add(request.confirmId);
    try {
      onRespond(request.confirmId, accept);
      announce('polite', t('confirm.sent'));
    } catch {
      announce('assertive', t('confirm.refused'));
    }
    dismiss(request.confirmId);
  };

  void tick;
  const leftMs = Math.max(0, request.expiresAt - now());
  const fraction = Math.min(1, leftMs / (span.current?.total ?? CONFIRM_SERVER_TTL_MS));
  const title = t('confirm.title', { amount: formatUsd(request.amount), n: paddle });

  return (
    <Sheet open onClose={() => dismiss(request.confirmId)} title={title}>
      <div className="bid-confirm">
        <p className="bid-confirm__title">{title}</p>
        {changed && currentCents !== null && !isExpired && (
          <p role="status">{t('confirm.changed', { amount: formatUsd(currentCents) })}</p>
        )}
        {isExpired ? (
          <>
            <p role="status">{t('confirm.expired')}</p>
            <Button size="bid" variant="outline" onClick={() => dismiss(request.confirmId)}>
              {t('generic.close')}
            </Button>
          </>
        ) : (
          <>
            <div className="bid-confirm__count" aria-hidden="true">
              <div className="bid-confirm__bar">
                <div className="bid-confirm__fill" style={{ transform: `scaleX(${fraction})` }} />
              </div>
              <span>{t('confirm.secondsLeft', { s: Math.ceil(leftMs / 1000) })}</span>
            </div>
            <Button size="bid" onClick={() => respond(true)}>
              {t('confirm.yes')}
            </Button>
            <Button size="bid" variant="outline" onClick={() => respond(false)}>
              {t('confirm.no')}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
