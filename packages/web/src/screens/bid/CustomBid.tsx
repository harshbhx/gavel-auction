import { useState, type FormEvent } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { formatUsd, formatUsdCompact, parseUsdToCents } from '../../util/money';

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
  if (ceilingCents !== null && cents > ceilingCents) {
    return t('bid.rej.over_ceiling', { max: formatUsdCompact(ceilingCents) });
  }
  return undefined;
}

/** Why an amount typed in the box cannot be sent, or undefined when it can. Never silent. */
export function customReason(
  text: string,
  nextMinCents: number,
  ceilingCents: number | null,
): string | undefined {
  if (text.trim() === '') return t('bid.enterAmount', { min: formatUsd(nextMinCents) });
  const cents = parseUsdToCents(text);
  if (cents === null) return t('bid.notAnAmount');
  return customHint(cents, nextMinCents, ceilingCents);
}

/**
 * Custom amount: sent only by Enter or the Place bid button (R-WEB-056, R-WEB-057). The button
 * stays pressable: an amount that cannot be sent gets its reason on screen, never a dead button.
 */
export function CustomBid({ nextMinCents, ceilingCents, onBid }: CustomBidProps) {
  const [text, setText] = useState('');
  const [attempted, setAttempted] = useState(false);
  const cents = parseUsdToCents(text);
  const reason = customReason(text, nextMinCents, ceilingCents);
  const live = text.trim() === '' ? undefined : reason;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (reason !== undefined || cents === null) {
      setAttempted(true);
      announce('assertive', reason ?? t('bid.notAnAmount'));
      return;
    }
    setAttempted(false);
    onBid(cents);
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field
        label={t('bid.custom')}
        value={text}
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setAttempted(false);
        }}
        {...(attempted && reason !== undefined
          ? { error: reason }
          : live === undefined
            ? {}
            : { hint: live })}
      />
      <Button type="submit">{t('bid.place')}</Button>
    </form>
  );
}
