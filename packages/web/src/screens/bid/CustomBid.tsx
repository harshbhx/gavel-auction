import { useState, type FormEvent, type KeyboardEvent } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { formatUsd, formatUsdCompact, parseUsdToCents } from '../../util/money';

export interface CustomBidProps {
  nextMinCents: number;
  ceilingCents: number | null;
  /** The room's minimum increment in cents; the stepper and slider move by it. */
  incrementCents?: number;
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

/** Cents as the text the box takes: whole dollars when it can, else two decimals. */
export function centsToText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * One step from a value, kept between the next minimum and the limit. Without a usable value the
 * step starts at the next minimum. Never returns more than the limit once the limit is known.
 */
export function stepAmount(
  current: number | null,
  direction: 1 | -1,
  nextMinCents: number,
  incrementCents: number,
  ceilingCents: number | null,
): number {
  // A limit under the next minimum leaves nothing to step to: answer the minimum, never a
  // smaller amount the server would refuse.
  if (ceilingCents !== null && ceilingCents < nextMinCents) return nextMinCents;
  const base = current ?? nextMinCents;
  const stepped = current === null ? nextMinCents : base + direction * incrementCents;
  const capped = ceilingCents === null ? stepped : Math.min(stepped, ceilingCents);
  return Math.max(capped, Math.min(nextMinCents, ceilingCents ?? nextMinCents));
}

/** Top of the slider: the highest amount on the step ladder that is not above the limit. */
export function sliderMax(
  nextMinCents: number,
  incrementCents: number,
  ceilingCents: number | null,
): number | null {
  if (ceilingCents === null || incrementCents <= 0 || ceilingCents < nextMinCents) return null;
  return nextMinCents + Math.floor((ceilingCents - nextMinCents) / incrementCents) * incrementCents;
}

/**
 * Custom amount: sent only by Enter or the Place bid button (R-WEB-056, R-WEB-057). The button
 * stays pressable: an amount that cannot be sent gets its reason on screen, never a dead button.
 */
export function CustomBid({
  nextMinCents,
  ceilingCents,
  incrementCents = 100,
  onBid,
}: CustomBidProps) {
  const [text, setText] = useState('');
  const [attempted, setAttempted] = useState(false);
  const cents = parseUsdToCents(text);
  const reason = customReason(text, nextMinCents, ceilingCents);
  const live = text.trim() === '' ? undefined : reason;

  const inc = incrementCents > 0 ? incrementCents : 100;
  const top = sliderMax(nextMinCents, inc, ceilingCents);
  const set = (next: number): void => {
    setText(centsToText(next));
    setAttempted(false);
  };
  const step = (direction: 1 | -1): void =>
    set(stepAmount(cents, direction, nextMinCents, inc, ceilingCents));
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(e.key === 'ArrowUp' ? 1 : -1);
    }
  };
  const sliderValue =
    top === null ? nextMinCents : Math.min(Math.max(cents ?? nextMinCents, nextMinCents), top);
  const pricedOut = ceilingCents !== null && ceilingCents < nextMinCents;
  const atMin = pricedOut || (cents !== null && cents <= nextMinCents);
  const atMax =
    pricedOut || (ceilingCents !== null && cents !== null && cents >= (top ?? ceilingCents));

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
    <form onSubmit={submit} noValidate className="bid__custom">
      <div className="bid__stepper">
        <Button
          type="button"
          className="bid__stepbtn"
          aria-label={t('bid.step.down', { amount: formatUsdCompact(inc) })}
          disabled={atMin}
          onClick={() => step(-1)}
        >
          {t('bid.minus', { amount: formatUsdCompact(inc) })}
        </Button>
        <Field
          label={t('bid.custom')}
          value={text}
          inputMode="numeric"
          autoComplete="off"
          onKeyDown={onKey}
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
        <Button
          type="button"
          className="bid__stepbtn"
          aria-label={t('bid.step.up', { amount: formatUsdCompact(inc) })}
          disabled={atMax}
          onClick={() => step(1)}
        >
          {t('bid.plus', { amount: formatUsdCompact(inc) })}
        </Button>
      </div>
      {top !== null && top > nextMinCents && (
        <input
          type="range"
          className="bid__range"
          aria-label={t('bid.slider', {
            min: formatUsdCompact(nextMinCents),
            max: formatUsdCompact(top),
          })}
          aria-valuetext={formatUsd(sliderValue)}
          min={nextMinCents}
          max={top}
          step={inc}
          value={sliderValue}
          onChange={(e) => set(Number(e.target.value))}
        />
      )}
      <Button type="submit" disabled={pricedOut}>
        {t('bid.place')}
      </Button>
    </form>
  );
}
