import { useState, type FormEvent } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { formatUsd, parseUsdToCents } from '../../util/money';

export interface CustomBidProps {
  nextMinCents: number;
  ceilingCents: number | null;
  /** The guarded send. */
  onBid: (cents: number) => void;
}

/** Hint text for an amount, or undefined when it looks fine. The server stays authoritative. */
export function customHint(
  cents: number | null,
  nextMinCents: number,
  ceilingCents: number | null,
): string | undefined {
  if (cents === null) return undefined;
  if (cents < nextMinCents) return t('bid.rej.below_increment', { min: formatUsd(nextMinCents) });
  if (ceilingCents !== null && cents > ceilingCents) return t('bid.aboveCeiling');
  return undefined;
}

/** Custom amount: sent only by Enter or the Place bid button (R-WEB-056, R-WEB-057). */
export function CustomBid({ nextMinCents, ceilingCents, onBid }: CustomBidProps) {
  const [text, setText] = useState('');
  const cents = parseUsdToCents(text);
  const hint = customHint(cents, nextMinCents, ceilingCents);
  const sendable = cents !== null && hint === undefined;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (cents !== null && sendable) onBid(cents);
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field
        label={t('bid.custom')}
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        {...(hint === undefined ? {} : { hint })}
      />
      <Button type="submit" disabled={!sendable}>
        {t('bid.place')}
      </Button>
    </form>
  );
}
