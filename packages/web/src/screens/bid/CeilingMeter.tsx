import { t } from '../../copy/t';
import { formatUsdCompact } from '../../util/money';

export interface CeilingMeterProps {
  /** Highest accepted bid of this bidder, in cents. */
  usedCents: number;
  /** The bidder's ceiling, in cents. */
  maxCents: number;
}

/** Highest own accepted bid against the ceiling, as text and as a bar (R-WEB-058). */
export function CeilingMeter({ usedCents, maxCents }: CeilingMeterProps) {
  const now = Math.min(Math.max(usedCents, 0), maxCents);
  const percent = maxCents > 0 ? Math.round((now / maxCents) * 100) : 0;
  const text = t('bid.ceilingMeter', {
    used: formatUsdCompact(usedCents),
    max: formatUsdCompact(maxCents),
  });
  return (
    <div>
      <p>{text}</p>
      <div
        role="meter"
        aria-label={t('bid.ceilingMeter', {
          used: formatUsdCompact(usedCents),
          max: formatUsdCompact(maxCents),
        })}
        aria-valuenow={now}
        aria-valuemin={0}
        aria-valuemax={maxCents}
        aria-valuetext={text}
        style={{ height: 8, background: 'var(--gv-border, #ccc)', borderRadius: 4 }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: 'var(--gv-accent, #0050d0)',
            borderRadius: 4,
          }}
        />
      </div>
    </div>
  );
}
