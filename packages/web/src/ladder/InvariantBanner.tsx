import { t } from '../copy/t';
import { Icon } from '../design/icons';
import type { LadderInvariants } from './ladderModel';

export interface InvariantBannerProps {
  invariants: LadderInvariants | null;
}

/** Red "Needs review" banner. A violated invariant is always shown, never hidden (R-WEB-091). */
export function InvariantBanner({ invariants }: InvariantBannerProps) {
  if (invariants === null) return null;
  if (invariants.unreported) {
    return (
      <p role="status" className="gv-ladder__note" data-kind="invariant-unreported">
        {t('ladder.invariantsNotReported')}
      </p>
    );
  }
  if (!invariants.violated) return null;
  return (
    <div role="alert" className="gv-ladder__banner" data-tone="danger" data-kind="invariant">
      <p>
        <Icon name="warning" />
        {t('ladder.invariants.bad')}
      </p>
      {invariants.serverViolations.length > 0 && (
        <ul>
          {invariants.serverViolations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
