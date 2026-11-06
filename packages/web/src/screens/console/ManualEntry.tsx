import { useRef, useState, type FormEvent } from 'react';
import { Cents, type BidderId } from '@gavel/shared';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { Icon } from '../../design/icons';
import { parseUsdToCents } from '../../util/money';
import type { PendingStatus } from '../../store/localEvents';
import { rejectionText } from './BidStream';

export interface ManualEntryProps {
  /** Who holds which paddle, from the room snapshot. */
  roster: readonly { bidderId: BidderId; paddle: number }[];
  /** Sends one bid with source manual. The parent owns the message id and the pending tracker. */
  onSubmit: (amount: Cents, bidderId: BidderId) => ManualSendResult;
  /** Error code of the last rejected manual bid, shown beside the field. Null when none. */
  rejection: string | null;
  /** The socket is down: the form keeps what was typed and says nothing was sent. */
  offline?: boolean;
  /** Outcome of the latest manual bid, or null before one was sent. */
  status?: PendingStatus | null;
  /** Sends the latest manual bid again under its original id. */
  onRetry?: () => void;
}

/** Whether the bid left this device. Anything but 'sent' keeps the typed amount. */
export type ManualSendResult = 'sent' | 'noRoom' | 'offline' | 'failed';

type Problem = 'paddle' | 'amount' | ManualSendResult | null;

const SEND_PROBLEM_COPY = {
  noRoom: 'console.manual.noRoom',
  offline: 'console.manual.offline',
  failed: 'console.manual.sendFailed',
} as const;

const STATUS_COPY = {
  pending: 'console.manual.pending',
  accepted: 'console.manual.accepted',
  unknown: 'console.manual.unknown',
} as const;

/** Paddle and amount form. Enter sends one bid; the server decides whether it stands (R-WEB-068). */
export function ManualEntry({
  roster,
  onSubmit,
  rejection,
  offline = false,
  status = null,
  onRetry,
}: ManualEntryProps) {
  const [paddle, setPaddle] = useState('');
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const justSent = useRef(false);

  const submit = (ev: FormEvent<HTMLFormElement>): void => {
    ev.preventDefault();
    // A repeat Enter after a send, before the amount is edited, is not a new bid.
    if (justSent.current) return;
    const paddleNo = /^\d{1,6}$/.test(paddle.trim()) ? Number(paddle.trim()) : null;
    const entry = paddleNo === null ? undefined : roster.find((r) => r.paddle === paddleNo);
    if (entry === undefined) {
      setProblem('paddle');
      return;
    }
    const cents = parseUsdToCents(amount);
    if (cents === null) {
      setProblem('amount');
      return;
    }
    const sent = onSubmit(Cents(cents), entry.bidderId);
    if (sent !== 'sent') {
      // Nothing left this device: keep the typed values so the bid can be sent again.
      setProblem(sent);
      return;
    }
    setProblem(null);
    // Clearing the amount means a second Enter cannot send the same bid again.
    setAmount('');
    justSent.current = true;
  };

  const sendProblem =
    problem !== null && problem !== 'paddle' && problem !== 'amount' && problem !== 'sent'
      ? t(SEND_PROBLEM_COPY[problem])
      : null;

  const warn = <Icon name="warning" size={14} />;
  return (
    <form className="gv-manual" aria-label={t('console.manual')} onSubmit={submit} noValidate>
      <Field
        label={t('console.manual.paddle')}
        inputMode="numeric"
        autoComplete="off"
        value={paddle}
        onChange={(e) => setPaddle(e.target.value)}
        {...(problem === 'paddle' ? { error: t('console.manual.badPaddle'), errorIcon: warn } : {})}
      />
      <Field
        label={t('console.manual.amount')}
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        onChange={(e) => {
          justSent.current = false;
          setAmount(e.target.value);
        }}
        {...(problem === 'amount'
          ? { error: t('console.manual.badAmount'), errorIcon: warn }
          : sendProblem !== null
            ? { error: sendProblem, errorIcon: warn }
            : offline
              ? { error: t('console.manual.offline'), errorIcon: warn }
              : problem === null && rejection !== null
                ? { error: rejectionText(rejection), errorIcon: warn }
                : {})}
      />
      <Button type="submit" disabled={offline}>
        {t('console.manual.submit')}
      </Button>
      {status !== null && status !== 'rejected' && <p role="status">{t(STATUS_COPY[status])}</p>}
      {status === 'unknown' && onRetry !== undefined && (
        <Button type="button" variant="outline" onClick={onRetry}>
          {t('console.manual.retry')}
        </Button>
      )}
    </form>
  );
}
