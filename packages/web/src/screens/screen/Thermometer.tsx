import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';
import type { Thermometer as ThermometerData } from './fundraiser';

/** Raised against the goal. The fill is a scaleX transform, so it never reflows the screen. */
export function FundraiserThermometer({ data }: { data: ThermometerData }) {
  const pct = Math.round(data.fill * 100);
  return (
    <section
      className="gv-thermo"
      aria-label={t('screen.raisedLabel')}
      data-reached={data.reached ? 'true' : 'false'}
    >
      <p className="gv-thermo__line tabular">
        {t('screen.raised', {
          raised: formatUsd(data.raisedCents),
          goal: formatUsd(data.goalCents),
        })}
      </p>
      <div
        className="gv-thermo__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={t('screen.raised', {
          raised: formatUsd(data.raisedCents),
          goal: formatUsd(data.goalCents),
        })}
      >
        <div className="gv-thermo__fill" style={{ transform: `scaleX(${data.fill})` }} />
      </div>
      {data.onHoldCents > 0 && (
        <p className="gv-thermo__hold tabular">
          {t('screen.onHold', { amount: formatUsd(data.onHoldCents) })}
        </p>
      )}
    </section>
  );
}
