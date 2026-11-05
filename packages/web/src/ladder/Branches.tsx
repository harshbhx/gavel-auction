import { t } from '../copy/t';
import { Icon } from '../design/icons';
import type { LadderModel } from './ladderModel';

export interface BranchesProps {
  model: LadderModel;
  /** Link target for the audit view, for example /r/<roomId>/audit. */
  auditHref: string;
}

/**
 * Branch notices for the ladder: why a winner was replaced and the persistent
 * FAILED_NEEDS_REVIEW banner (R-WEB-092). The runner-up lane is marked with
 * data-highlight so the lane list can style it.
 */
export function Branches({ model, auditHref }: BranchesProps) {
  const { fallback, failed } = model;
  return (
    <>
      {fallback !== null && (
        <p
          className="gv-ladder__note"
          data-kind="fallback"
          data-runner-up={fallback.runnerUpPaddle ?? undefined}
        >
          {t('ladder.fallback', {
            reason: fallback.reason ?? '',
            n: fallback.runnerUpPaddle ?? '',
          })}
        </p>
      )}
      {failed !== null && (
        <div role="alert" className="gv-ladder__banner" data-tone="danger" data-kind="failed">
          <p>
            <Icon name="warning" />
            {t('ladder.failed')}
            {failed.reason !== null && failed.reason !== '' && <> {failed.reason}</>}
          </p>
          <a href={auditHref}>{t('audit.title')}</a>
        </div>
      )}
    </>
  );
}

/** True for the lane that should be highlighted as the new winner after a fallback. */
export function isRunnerUpLane(model: LadderModel, paddle: number): boolean {
  return model.fallback !== null && model.fallback.runnerUpPaddle === paddle;
}
