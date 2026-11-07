import { useState } from 'react';
import { formatUsd } from '../util/money';
import { PriceRoll } from './PriceRoll';

export type HoldState = 'held' | 'charged' | 'released';

export interface HoldCardProps {
  state: HoldState;
  /** The hold: the most the bidder can be charged, in cents. */
  ceilingCents: number;
  /** The charge, in cents. Used when state is "charged". */
  chargedCents?: number;
  /** Optional line above the amount, such as a paddle number. */
  caption?: string;
}

const TAGS: Readonly<Record<HoldState, string>> = {
  held: 'Held',
  charged: 'Charged',
  released: 'Released',
};

function describe(state: HoldState, ceiling: number, charged: number): string {
  if (state === 'held') return `Held on PayPal. Nothing charged. ${formatUsd(ceiling)} set aside.`;
  if (state === 'charged') {
    return `Charged ${formatUsd(charged)}. ${formatUsd(Math.max(0, ceiling - charged))} released.`;
  }
  return `Released. Nothing was charged. ${formatUsd(ceiling)} is back on PayPal.`;
}

/** Shows only the hold: hatched while held, solid once charged, hollow when released. Always with text. */
export function HoldCard({ state, ceilingCents, chargedCents = 0, caption }: HoldCardProps) {
  const [hidden, setHidden] = useState(false);
  const charged = Math.min(Math.max(0, chargedCents), ceilingCents);
  const shown = state === 'charged' ? charged : ceilingCents;
  const text = describe(state, ceilingCents, charged);
  const solidFlex = state === 'charged' ? Math.max(charged, 1) : 0;
  const hollowFlex = Math.max(ceilingCents - charged, state === 'charged' ? 0 : 1);

  return (
    <section className="ui-holdcard" data-state={state} aria-label="Your hold">
      <div className="ui-holdcard__top">
        {caption !== undefined && <span className="ui-kicker">{caption}</span>}
        <button
          type="button"
          className="ui-link"
          aria-pressed={hidden}
          onClick={() => {
            setHidden((h) => !h);
          }}
        >
          {hidden ? 'Show amount' : 'Hide amount'}
        </button>
      </div>
      <div className="ui-holdcard__amt" aria-live="polite">
        {hidden ? (
          <span className="ui-holdcard__mask" role="img" aria-label="Amount hidden">
            {'$•••.••'}
          </span>
        ) : (
          <PriceRoll cents={shown} />
        )}
      </div>
      <div className="ui-holdcard__state">
        <em className={`ui-holdcard__tag ui-holdcard__tag--${state}`}>{TAGS[state]}</em>
        <span>{hidden ? text.replace(/\$[\d,]+\.\d{2}/g, 'an amount') : text}</span>
      </div>
      <div className="ui-holdbar" role="img" aria-label={hidden ? TAGS[state] : text}>
        {state === 'held' && <i className="ui-holdbar__held" />}
        {state === 'charged' && (
          <>
            <i className="ui-holdbar__charged" style={{ flex: solidFlex }} />
            {hollowFlex > 0 && <i className="ui-holdbar__released" style={{ flex: hollowFlex }} />}
          </>
        )}
        {state === 'released' && <i className="ui-holdbar__released ui-holdbar__released--full" />}
      </div>
      <ul className="ui-legend" aria-label="Legend">
        <li>
          <i className="ui-legend__held" />
          Hatched = held
        </li>
        <li>
          <i className="ui-legend__charged" />
          Solid = charged
        </li>
        <li>
          <i className="ui-legend__released" />
          Hollow = released
        </li>
      </ul>
    </section>
  );
}
