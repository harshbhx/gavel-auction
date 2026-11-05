import { useRef, useState, type FormEvent } from 'react';
import { Cents, type BidderId } from '@gavel/shared';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { Icon } from '../../design/icons';
import { parseUsdToCents } from '../../util/money';
import { rejectionText } from './BidStream';

export interface ManualEntryProps {
  /** Who holds which paddle, from the room snapshot. */
  roster: readonly { bidderId: BidderId; paddle: number }[];
  /** Sends one bid with source manual. The parent owns the message id and the pending tracker. */
  onSubmit: (amount: Cents, bidderId: BidderId) => void;
  /** Error code of the last rejected manual bid, shown beside the field. Null when none. */
  rejection: string | null;
}

type Problem = 'paddle' | 'amount' | null;

/** Paddle and amount form. Enter sends one bid; the server decides whether it stands (R-WEB-068). */
export function ManualEntry({ roster, onSubmit, rejection }: ManualEntryProps) {
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
    setProblem(null);
    // Clearing the amount means a second Enter cannot send the same bid again.
    setAmount('');
    justSent.current = true;
    onSubmit(Cents(cents), entry.bidderId);
  };

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
          : problem === null && rejection !== null
            ? { error: rejectionText(rejection), errorIcon: warn }
            : {})}
      />
      <Button type="submit">{t('console.manual.submit')}</Button>
    </form>
  );
}
