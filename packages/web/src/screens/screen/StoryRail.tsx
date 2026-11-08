import { t } from '../../copy/t';

/** 0 = bidding (holds), 1 = hammer fell, 2 = settlement counts are in (receipt). */
export type StoryPhase = 0 | 1 | 2;

const STEPS = [
  { key: 'hold', label: 'screen.story.hold', note: 'screen.story.holdNote' },
  { key: 'hammer', label: 'screen.story.hammer', note: 'screen.story.hammerNote' },
  { key: 'receipt', label: 'screen.story.receipt', note: 'screen.story.receiptNote' },
] as const;

/** Three-step strip for the room: hold, hammer, receipt. Position is always said in words and a number. */
export function StoryRail({ phase }: { readonly phase: StoryPhase }) {
  return (
    <ol className="gv-story" aria-label={t('screen.story.label')} data-testid="story-rail">
      {STEPS.map((step, i) => (
        <li
          key={step.key}
          className="gv-story__step"
          data-status={i < phase ? 'done' : i === phase ? 'now' : 'next'}
          aria-current={i === phase ? 'step' : undefined}
        >
          <span className="gv-story__label tabular">{`${i + 1}. ${t(step.label)}`}</span>
          <span className="gv-story__note">{t(step.note)}</span>
        </li>
      ))}
    </ol>
  );
}
