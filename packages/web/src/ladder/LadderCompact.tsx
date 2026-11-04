import { t } from '../copy/t';
import { buildLadder, type LadderLane, type SettlementView } from './ladderModel';

export interface LadderCompactProps {
  /** Latest settlement view for the lot, or null before the first settlement update. */
  view: SettlementView | null;
}

type DotClass = 'captured' | 'released' | 'review' | 'open';

/**
 * Money wording follows the server: a dot counts as captured only in the CAPTURED state and as
 * released only when the server reports the hold voided or released.
 */
function classOf(lane: LadderLane): DotClass {
  if (lane.state === 'CAPTURED') return 'captured';
  if (lane.state === 'FAILED_NEEDS_REVIEW') return 'review';
  if (lane.canSayReleased) return 'released';
  return 'open';
}

const SIZE = 12;
const MID = SIZE / 2;

/** The shape differs per class so the state never relies on colour alone. */
function Dot({ kind }: { kind: DotClass }) {
  const common = { 'aria-hidden': true, width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}` };
  switch (kind) {
    case 'captured':
      return (
        <svg {...common}>
          <circle cx={MID} cy={MID} r={5} fill="currentColor" />
        </svg>
      );
    case 'released':
      return (
        <svg {...common}>
          <circle cx={MID} cy={MID} r={4.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
        </svg>
      );
    case 'review':
      return (
        <svg {...common}>
          <path d={`M${MID} 1L11 ${MID}L${MID} 11L1 ${MID}Z`} fill="currentColor" />
        </svg>
      );
    case 'open':
      return (
        <svg {...common}>
          <rect
            x={1.5}
            y={1.5}
            width={9}
            height={9}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          />
        </svg>
      );
  }
}

/** Summary bar for the console bottom strip and the public screen: one dot per hold plus counts. */
export function LadderCompact({ view }: LadderCompactProps) {
  const model = buildLadder(view);
  if (model.waiting) return <p role="status">{t('ladder.waiting')}</p>;
  const kinds = model.lanes.map(classOf);
  const captured = kinds.filter((k) => k === 'captured').length;
  const released = kinds.filter((k) => k === 'released').length;
  return (
    <div className="gv-ladder-compact">
      <ul
        aria-label={t('ladder.title')}
        style={{ display: 'flex', gap: 4, listStyle: 'none', margin: 0, padding: 0 }}
      >
        {model.lanes.map((lane, i) => (
          <li
            key={lane.paddle}
            aria-label={`${lane.paddle} ${t(`ladder.state.${lane.state}`)}`}
            data-kind={kinds[i]}
          >
            <Dot kind={kinds[i] ?? 'open'} />
          </li>
        ))}
      </ul>
      <p role="status">{t('screen.settleSummary', { c: captured, r: released })}</p>
    </div>
  );
}
