import { useEffect, useRef, useState } from 'react';
import { keepFocusOnOverlay, useFocusTrap } from '../a11y/useFocus';
import { t } from '../copy/t';
import { TOUR_STEPS, type TourStepId } from './tourState';

const TITLES = {
  join: () => t('tour.join.title'),
  ceiling: () => t('tour.ceiling.title'),
  hold: () => t('tour.hold.title'),
  bid: () => t('tour.bid.title'),
  hammer: () => t('tour.hammer.title'),
  receipt: () => t('tour.receipt.title'),
} satisfies Record<TourStepId, () => string>;

const BODIES = {
  join: () => t('tour.join.body'),
  ceiling: () => t('tour.ceiling.body'),
  hold: () => t('tour.hold.body'),
  bid: () => t('tour.bid.body'),
  hammer: () => t('tour.hammer.body'),
  receipt: () => t('tour.receipt.body'),
} satisfies Record<TourStepId, () => string>;

/** A step spotlights the first match. A screen can opt in with data-tour="<step>". */
const TARGETS: Record<TourStepId, string> = {
  join: '[data-tour="join"], .gv-landing__join, .ui-otp',
  ceiling: '[data-tour="ceiling"], .ui-slider, .bid__meter',
  hold: '[data-tour="hold"], .ui-holdcard',
  bid: '[data-tour="bid"], .bid__bar',
  hammer: '[data-tour="hammer"]',
  receipt: '[data-tour="receipt"]',
};

export interface GuidedTourProps {
  /** Index into TOUR_STEPS. */
  step: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function findTarget(id: TourStepId): Element | null {
  try {
    return document.querySelector(TARGETS[id]);
  } catch {
    return null;
  }
}

/** Skippable six-step tour. Shows a spotlight when the step's element is on screen, else a plain card. */
export function GuidedTour({ step, onNext, onBack, onSkip }: GuidedTourProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  useFocusTrap(cardRef, { active: true });

  const index = Math.min(Math.max(0, step), TOUR_STEPS.length - 1);
  const id = TOUR_STEPS[index] ?? 'join';
  const last = index === TOUR_STEPS.length - 1;

  useEffect(() => {
    const target = findTarget(id);
    if (target === null) {
      setBox(null);
      return undefined;
    }
    try {
      target.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    } catch {
      // Older engines and test DOMs have no scrollIntoView; the spotlight still shows.
    }
    const measure = (): void => {
      const r = target.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [id]);

  // On the document, so the keys still work after a click on the veil moved focus to the body.
  const keys = useRef({ onNext, onBack, onSkip, index });
  keys.current = { onNext, onBack, onSkip, index };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const k = keys.current;
      if (e.key === 'Escape') k.onSkip();
      else if (e.key === 'ArrowRight') k.onNext();
      else if (e.key === 'ArrowLeft' && k.index > 0) k.onBack();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="help-tour" role="presentation" onMouseDown={keepFocusOnOverlay}>
      {box === null ? (
        <div className="help-tour__veil" aria-hidden="true" />
      ) : (
        <div
          className="help-tour__spot"
          aria-hidden="true"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
          }}
        />
      )}
      <div
        ref={cardRef}
        className="help-tour__card"
        role="dialog"
        aria-modal="true"
        aria-label={t('tour.aria')}
        aria-describedby="help-tour-body"
      >
        <p className="ui-kicker">
          {t('tour.progress', { n: index + 1, total: TOUR_STEPS.length })}
        </p>
        <div aria-live="polite">
          <h2 className="help-tour__title">{TITLES[id]()}</h2>
          <p id="help-tour-body">{BODIES[id]()}</p>
        </div>
        <div className="help-tour__actions">
          <button type="button" className="help-btn help-btn--solid" onClick={onNext}>
            {last ? t('tour.done') : t('tour.next')}
          </button>
          {index > 0 && (
            <button type="button" className="help-btn" onClick={onBack}>
              {t('tour.back')}
            </button>
          )}
          <button type="button" className="ui-link" onClick={onSkip}>
            {t('tour.skip')}
          </button>
        </div>
      </div>
    </div>
  );
}
