import { useEffect, useRef } from 'react';
import { t } from '../copy/t';
import { HoldCard } from '../ui/HoldCard';

/** Example amounts in cents, shown only to explain the three states. */
const SAMPLE_CEILING_CENTS = 5000;
const SAMPLE_CHARGED_CENTS = 3200;

/** Body of the "What is a hold?" sheet: hatched = held, solid = charged, hollow = released. */
export function HoldExplainer() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return (
    <div className="help-hold">
      <h2 ref={titleRef} tabIndex={-1} className="help-hold__title">
        {t('help.hold.title')}
      </h2>
      <p>{t('help.hold.intro')}</p>
      <p className="ui-kicker">{t('help.hold.sample')}</p>
      <div className="help-hold__item">
        <h3>{t('help.hold.heldTitle')}</h3>
        <p>{t('help.hold.held')}</p>
        <HoldCard
          state="held"
          ceilingCents={SAMPLE_CEILING_CENTS}
          ariaLabel={t('help.hold.heldTitle')}
        />
      </div>
      <div className="help-hold__item">
        <h3>{t('help.hold.chargedTitle')}</h3>
        <p>{t('help.hold.charged')}</p>
        <HoldCard
          state="charged"
          ceilingCents={SAMPLE_CEILING_CENTS}
          chargedCents={SAMPLE_CHARGED_CENTS}
          ariaLabel={t('help.hold.chargedTitle')}
        />
      </div>
      <div className="help-hold__item">
        <h3>{t('help.hold.releasedTitle')}</h3>
        <p>{t('help.hold.released')}</p>
        <HoldCard
          state="released"
          ceilingCents={SAMPLE_CEILING_CENTS}
          ariaLabel={t('help.hold.releasedTitle')}
        />
      </div>
    </div>
  );
}
