import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Chip } from '../../design/primitives/Chip';
import type { RoomSnapshot } from '../../wire';

export type RosterRow = RoomSnapshot['roster'][number];

export interface RosterProps {
  readonly roster: readonly RosterRow[];
  /** Bidders with a live connection right now. */
  readonly connected: number;
}

export function Roster({ roster, connected }: RosterProps) {
  const holds = roster.filter((r) => r.hold === 'HELD').length;
  return (
    <section aria-label={t('console.roster')}>
      <p>{t('console.bidders', { n: connected, m: holds })}</p>
      {roster.length === 0 ? (
        <p>{t('console.noBidders')}</p>
      ) : (
        <ul>
          {roster.map((r) => (
            <li key={r.bidderId}>
              <span>{`${r.paddle} ${r.name}`}</span>
              {r.hold !== 'HELD' && (
                <Chip
                  state="hold-warning"
                  label={t('console.holdWarn')}
                  icon={<Icon name="warning" size={16} />}
                  tone="warning"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
