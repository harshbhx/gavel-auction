import { useEffect, useRef, useState } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { formatUsdCompact } from '../../util/money';
import type { ConfirmRequestMsg } from '../../wire';
import { confirmShortcut } from './shortcuts';

export interface ConfirmQueueProps {
  /** Pending requests, oldest first. The parent drops one when its bid is accepted or rejected. */
  requests: readonly ConfirmRequestMsg[];
  /** Current server time in epoch ms. */
  now: () => number;
  /** Called once per request with the auctioneer's answer. */
  onAnswer: (confirmId: string, accept: boolean) => void;
}

function secondsLeft(expiresAt: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAt - nowMs) / 1000));
}

/** Pending confirmations with a countdown and Y, N, J, K keys (R-WEB-067). */
export function ConfirmQueue({ requests, now, onAnswer }: ConfirmQueueProps) {
  const [selected, setSelected] = useState(0);
  const [, setTick] = useState(0);
  // Answered ids, set before the send so a double key press cannot send twice.
  const sent = useRef(new Set<string>());
  const [sentIds, setSentIds] = useState<readonly string[]>([]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Forget ids that left the queue, and keep the selection inside it.
  useEffect(() => {
    const live = new Set(requests.map((r) => r.confirmId));
    for (const id of [...sent.current]) if (!live.has(id)) sent.current.delete(id);
    setSentIds((prev) =>
      prev.every((id) => live.has(id)) ? prev : prev.filter((id) => live.has(id)),
    );
    setSelected((s) => Math.min(s, Math.max(0, requests.length - 1)));
  }, [requests]);

  const answer = (index: number, accept: boolean): void => {
    const request = requests[index];
    if (request === undefined || sent.current.has(request.confirmId)) return;
    sent.current.add(request.confirmId);
    setSentIds((prev) => [...prev, request.confirmId]);
    onAnswer(request.confirmId, accept);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      const action = confirmShortcut(ev);
      if (action === null) return;
      ev.preventDefault();
      switch (action) {
        case 'next':
          setSelected((s) => Math.min(s + 1, Math.max(0, requests.length - 1)));
          break;
        case 'previous':
          setSelected((s) => Math.max(0, s - 1));
          break;
        case 'confirm':
          answer(selected, true);
          break;
        case 'reject':
          answer(selected, false);
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (requests.length === 0) {
    return (
      <section className="gv-confirm" aria-label={t('console.confirmQueue')}>
        <p>{t('console.noConfirm')}</p>
      </section>
    );
  }

  const nowMs = now();
  return (
    <section className="gv-confirm" aria-label={t('console.confirmQueue')}>
      <ul className="gv-confirm__list">
        {requests.map((req, index) => {
          const done = sentIds.includes(req.confirmId);
          return (
            <li
              key={req.confirmId}
              className="gv-confirm__item"
              aria-current={index === selected ? 'true' : undefined}
              data-selected={index === selected ? 'true' : 'false'}
              onClick={() => setSelected(index)}
            >
              <span className="tabular">{formatUsdCompact(req.amount)}</span>
              {req.transcript !== undefined && <span>{req.transcript}</span>}
              <span className="tabular">
                {t('console.confirm.expires', { s: secondsLeft(req.expiresAt, nowMs) })}
              </span>
              <Button disabled={done} onClick={() => answer(index, true)}>
                {t('console.confirm.accept')}
              </Button>
              <Button disabled={done} onClick={() => answer(index, false)}>
                {t('console.confirm.reject')}
              </Button>
              {done && <span role="status">{t('console.confirm.sent')}</span>}
            </li>
          );
        })}
      </ul>
      <p>{t('console.confirm.hint')}</p>
    </section>
  );
}
