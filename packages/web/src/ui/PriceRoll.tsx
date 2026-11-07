import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { changedIndexes, prefersReducedMotion, priceChars } from './format';
import { formatUsd } from '../util/money';

const ROLL_CLEAR_MS = 900;
const STAGGER_S = 0.03;

export interface PriceRollProps {
  /** Amount in integer cents. */
  cents: number;
  className?: string;
}

interface Roll {
  from: number;
  to: number;
}

/** An amount in tabular numerals. Digits that change roll one by one; reduced motion swaps them at once. */
export function PriceRoll({ cents, className }: PriceRollProps) {
  const previous = useRef(cents);
  const [roll, setRoll] = useState<Roll | null>(null);

  useEffect(() => {
    if (previous.current === cents) return undefined;
    const from = previous.current;
    previous.current = cents;
    if (prefersReducedMotion()) {
      setRoll(null);
      return undefined;
    }
    setRoll({ from, to: cents });
    const timer = setTimeout(() => {
      setRoll(null);
    }, ROLL_CLEAR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [cents]);

  const chars = priceChars(cents);
  const active = roll !== null && roll.to === cents ? roll : null;
  const rolling = active === null ? [] : changedIndexes(active.from, cents);
  const oldChars = active === null ? [] : priceChars(active.from);
  const sameLength = oldChars.length === chars.length;
  const classes = ['ui-price', className].filter((c): c is string => c !== undefined && c !== '');

  return (
    <span className={classes.join(' ')} role="img" aria-label={formatUsd(cents)}>
      {chars.map((ch, i) => {
        const isRolling = rolling.includes(i);
        const old = sameLength ? oldChars[i] : undefined;
        return (
          <span
            // Position is the identity of a digit slot.
            key={i}
            className={isRolling ? 'ui-price__dg ui-price__dg--roll' : 'ui-price__dg'}
            style={isRolling ? ({ '--ui-delay': `${i * STAGGER_S}s` } as CSSProperties) : undefined}
            aria-hidden="true"
          >
            {isRolling && old !== undefined && <b className="ui-price__old">{old}</b>}
            <b className={isRolling ? 'ui-price__new' : undefined}>{ch}</b>
          </span>
        );
      })}
    </span>
  );
}
