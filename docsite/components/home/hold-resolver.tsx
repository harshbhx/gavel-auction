'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

// The signature object: one lot, three holds, and the moment the hammer falls.
// Before the hammer every hold is hatched (held). After it, the winner's bar is solid up to the
// winning price (charged) and hollow for the rest (released); everyone else is hollow.
//
// Without JavaScript the page shows the resolved state, and the first play is a plain CSS
// animation (see .hl-hold in global.css), so it also runs before hydration and is switched
// off by prefers-reduced-motion. JavaScript adds the controls: a price slider and a replay.

type Bidder = { key: string; name: string; hold: number; wins: boolean };
const bidders: Bidder[] = [
  { key: 'A', name: 'Priya Raman', hold: 500, wins: true },
  { key: 'B', name: 'Tomas Eriksen', hold: 300, wins: false },
  { key: 'C', name: 'Lena Okafor', hold: 200, wins: false },
];

const total = bidders.reduce((n, b) => n + b.hold, 0);

export function HoldResolver() {
  const [price, setPrice] = useState(350);
  const [phase, setPhase] = useState<'held' | 'resolved'>('resolved');
  const [touched, setTouched] = useState(false); // after the first interaction the CSS intro is off
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const replay = () => {
    setTouched(true);
    setPhase('held');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase('resolved'), 650);
  };

  const resolved = phase === 'resolved';
  const charged = resolved ? price : 0;
  const released = resolved ? total - price : 0;
  const held = resolved ? 0 : total;

  return (
    <div
      className={cn('hl-hold relative border-[1.5px] border-[var(--hl-border)] bg-[var(--hl-panel)]')}
      data-intro={touched ? '0' : '1'}
      data-phase={phase}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--hl-hairline)] px-4 py-2.5">
        <p className="hl-eyebrow">Lot 14 · first-edition poster, 1962</p>
        <p className="hl-eyebrow">An example, not a record</p>
      </div>

      <ul className="space-y-4 px-4 py-5">
        {bidders.map((b) => {
          const pct = b.wins ? (price / b.hold) * 100 : 0;
          const state = !resolved ? 'held' : b.wins ? `charged ${price}` : 'released';
          return (
            <li key={b.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 font-mono text-[0.78rem]">
                <span>
                  <b className="hl-display text-base not-italic">{b.key}</b>&nbsp; {b.name}
                  <span className="text-[var(--hl-fg-muted)]"> · hold ${b.hold}</span>
                </span>
                <span
                  className={cn(
                    'font-bold',
                    resolved && b.wins ? 'text-[var(--hl-go)]' : 'text-[var(--hl-fg-muted)]',
                  )}
                >
                  {b.wins && resolved ? `charged $${price}` : state === 'held' ? 'held' : 'released'}
                </span>
              </div>
              {/* bar scale: 100% = the largest hold ($500) */}
              <div className="hl-hold__bar" style={{ width: `${(b.hold / 500) * 100}%` }}>
                <div className="hl-hold__hatch" />
                {b.wins && (
                  <div
                    className="hl-hold__solid"
                    style={{ width: `${pct}%`, opacity: resolved ? 1 : 0 }}
                  />
                )}
              </div>
              {b.wins && resolved && price < b.hold && (
                <p className="mt-1 font-mono text-[0.7rem] text-[var(--hl-fg-muted)]">
                  ${b.hold - price} of this hold is released, not charged
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-[var(--hl-hairline)] px-4 py-3">
        <p
          className="font-mono text-[0.78rem] tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="text-[var(--hl-fg-muted)]">ledger, in cents </span>
          held {held * 100} · charged {charged * 100} · released {released * 100}
          <span className="text-[var(--hl-fg-muted)]"> = {total * 100}</span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="button" onClick={replay} className="hl-hold__btn">
            {resolved ? 'Replay the hammer' : 'Hammer falling'}
          </button>
          <label className="flex items-center gap-2 font-mono text-[0.75rem]">
            <span>Winning price</span>
            <input
              type="range"
              min={100}
              max={500}
              step={10}
              value={price}
              onChange={(e) => {
                setTouched(true);
                setPhase('resolved');
                setPrice(Number(e.target.value));
              }}
              className="hl-hold__range w-32"
              aria-valuetext={`$${price}`}
            />
            <output className="w-10 font-bold tabular-nums">${price}</output>
          </label>
        </div>
      </div>
    </div>
  );
}
