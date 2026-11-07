import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Chip } from '../../design/primitives/Chip';
import { StatusPill } from '../../ui';
import { formatUsdCompact } from '../../util/money';
import type { RoomSnapshot } from '../../wire';

export type RosterRow = RoomSnapshot['roster'][number];

export interface RosterProps {
  readonly roster: readonly RosterRow[];
  /** Bidders with a live connection right now. */
  readonly connected: number;
  /** The bidder who leads now, marked in the ladder. */
  readonly leaderId?: string | null;
  /** Highest accepted bid per paddle, in cents. */
  readonly highBids?: Readonly<Record<number, number>>;
  /** Ceiling per paddle, in cents, where the server reports it (the settlement view). */
  readonly ceilings?: Readonly<Record<number, number>>;
}

/** The live bidder ladder: paddle, name, hold status, best bid and ceiling when known. */
export function Roster({ roster, connected, leaderId = null, highBids, ceilings }: RosterProps) {
  const holds = roster.filter((r) => r.hold === 'HELD').length;
  return (
    <section className="gv-console-ladder" aria-label={t('console.roster')}>
      <p>{t('console.bidders', { n: connected, m: holds })}</p>
      {roster.length === 0 ? (
        <p>{t('console.noBidders')}</p>
      ) : (
        <ul className="gv-console-ladder__list">
          {roster.map((r) => {
            const high = highBids?.[r.paddle];
            const ceiling = ceilings?.[r.paddle];
            return (
              <li
                key={r.bidderId}
                className="gv-console-ladder__row"
                data-leader={r.bidderId === leaderId ? 'true' : undefined}
                data-hold={r.hold === 'HELD' ? 'held' : 'none'}
              >
                <span className="gv-console-ladder__who">{`${r.paddle} ${r.name}`}</span>
                {high !== undefined && (
                  <span className="gv-console-ladder__amt">
                    {t('console.ladder.best', { amount: formatUsdCompact(high) })}
                  </span>
                )}
                {ceiling !== undefined && (
                  <span className="gv-console-ladder__amt">
                    {t('console.ladder.ceiling', { amount: formatUsdCompact(ceiling) })}
                  </span>
                )}
                {r.bidderId === leaderId && (
                  <StatusPill tone="win">{t('console.ladder.leading')}</StatusPill>
                )}
                {r.hold === 'HELD' && (
                  <StatusPill tone="held">{t('console.ladder.held')}</StatusPill>
                )}
                {r.hold !== 'HELD' && (
                  <Chip
                    state="hold-warning"
                    label={t('console.holdWarn')}
                    icon={<Icon name="warning" size={16} />}
                    tone="warning"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
