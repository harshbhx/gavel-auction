import { useState } from 'react';
import { t } from '../copy/t';
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
  /** Overrides the region name when several cards share a page. */
  ariaLabel?: string;
  /** Show the Hatched/Solid/Hollow legend. The bid screen leaves it to the help sheet. */
  legend?: boolean;
}

function tagFor(state: HoldState): string {
  if (state === 'held') return t('ui.hold.tagHeld');
  if (state === 'charged') return t('ladder.state.CAPTURED');
  return t('ui.hold.tagReleased');
}

function describe(state: HoldState, ceiling: number, charged: number, hidden: boolean): string {
  if (state === 'held') {
    return hidden
      ? t('ui.hold.textHeldHidden')
      : t('ui.hold.textHeld', { amount: formatUsd(ceiling) });
  }
  if (state === 'charged') {
    if (hidden) return t('ladder.state.CAPTURED');
    const rest = t('ui.hold.releasedRest', { amount: formatUsd(Math.max(0, ceiling - charged)) });
    return `${t('receipt.charged', { amount: formatUsd(charged) })}. ${rest}`;
  }
  return hidden
    ? t('ui.hold.textReleasedHidden')
    : t('ui.hold.textReleased', { amount: formatUsd(ceiling) });
}

/** Shows only the hold: hatched while held, solid once charged, hollow when released. Always with text. */
export function HoldCard({
  state,
  ceilingCents,
  chargedCents = 0,
  caption,
  ariaLabel,
  legend = true,
}: HoldCardProps) {
  const [hidden, setHidden] = useState(false);
  const charged = Math.min(Math.max(0, chargedCents), ceilingCents);
  const shown = state === 'charged' ? charged : ceilingCents;
  const text = describe(state, ceilingCents, charged, hidden);
  const solidFlex = state === 'charged' ? Math.max(charged, 1) : 0;
  const hollowFlex = Math.max(ceilingCents - charged, state === 'charged' ? 0 : 1);

  return (
    <section className="ui-holdcard" data-state={state} aria-label={ariaLabel ?? t('ui.hold.aria')}>
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
          {hidden ? t('ui.hold.show') : t('ui.hold.hide')}
        </button>
      </div>
      <div className="ui-holdcard__amt" aria-live="polite">
        {hidden ? (
          <span className="ui-holdcard__mask" role="img" aria-label={t('ui.hold.masked')}>
            {'$***.**'}
          </span>
        ) : (
          <PriceRoll cents={shown} />
        )}
      </div>
      <div className="ui-holdcard__state">
        <em className={`ui-holdcard__tag ui-holdcard__tag--${state}`}>{tagFor(state)}</em>
        <span>{text}</span>
      </div>
      <div className="ui-holdbar" role="img" aria-label={hidden ? tagFor(state) : text}>
        {state === 'held' && <i className="ui-holdbar__held" />}
        {state === 'charged' && (
          <>
            <i className="ui-holdbar__charged" style={{ flex: solidFlex }} />
            {hollowFlex > 0 && <i className="ui-holdbar__released" style={{ flex: hollowFlex }} />}
          </>
        )}
        {state === 'released' && <i className="ui-holdbar__released ui-holdbar__released--full" />}
      </div>
      {legend && (
      <ul className="ui-legend" aria-label={t('ui.hold.legend')}>
        <li>
          <i className="ui-legend__held" />
          {t('ui.hold.legendHeld')}
        </li>
        <li>
          <i className="ui-legend__charged" />
          {t('ui.hold.legendCharged')}
        </li>
        <li>
          <i className="ui-legend__released" />
          {t('ui.hold.legendReleased')}
        </li>
      </ul>
      )}
    </section>
  );
}
