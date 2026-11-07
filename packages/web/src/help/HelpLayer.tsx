import { useEffect, useReducer } from 'react';
import { t } from '../copy/t';
import { Sheet } from '../design/primitives/Sheet';
import { PaletteSwitch } from '../ui/PaletteSwitch';
import { GuidedTour } from './GuidedTour';
import { HoldExplainer } from './HoldExplainer';
import {
  TOUR_IDLE,
  hasSeenTour,
  helpReducer,
  isAutomatedBrowser,
  markTourSeen,
  shouldAutoStart,
  tourReducer,
} from './tourState';
import './help.css';

export interface HelpLayerProps {
  /** Overrides the first-visit check. Defaults to the stored record, URL flag and browser kind. */
  autoStart?: boolean;
}

/**
 * One help button for the landing, join, registration, bidder room and receipt routes.
 * Opens the hold explainer sheet or replays the guided tour.
 */
export function HelpLayer({ autoStart }: HelpLayerProps) {
  const [view, dispatchView] = useReducer(helpReducer, 'closed');
  const [tour, dispatchTour] = useReducer(tourReducer, TOUR_IDLE);

  useEffect(() => {
    const start =
      autoStart ??
      shouldAutoStart({
        search: window.location.search,
        seen: hasSeenTour(),
        automated: isAutomatedBrowser(),
      });
    if (start) dispatchTour({ type: 'start' });
  }, [autoStart]);

  useEffect(() => {
    if (tour.status === 'done' || tour.status === 'skipped') markTourSeen(tour.status);
  }, [tour.status]);

  const closeSheet = (): void => dispatchView({ type: 'close' });

  return (
    <aside className="help-layer" aria-label={t('help.title')}>
      <button
        type="button"
        className="help-fab"
        aria-haspopup="dialog"
        onClick={() => dispatchView({ type: 'openMenu' })}
      >
        {t('help.button')}
      </button>
      <Sheet open={view !== 'closed'} onClose={closeSheet} title={t('help.title')}>
        {view === 'menu' && (
          <div className="help-menu">
            <h2 className="help-menu__title">{t('help.title')}</h2>
            <button
              type="button"
              className="help-btn help-btn--solid"
              onClick={() => dispatchView({ type: 'openHold' })}
            >
              {t('help.open.hold')}
            </button>
            <button
              type="button"
              className="help-btn"
              onClick={() => {
                closeSheet();
                dispatchTour({ type: 'start' });
              }}
            >
              {t('help.open.tour')}
            </button>
            <PaletteSwitch />
            <button type="button" className="ui-link" onClick={closeSheet}>
              {t('help.close')}
            </button>
          </div>
        )}
        {view === 'hold' && (
          <>
            <HoldExplainer />
            <button type="button" className="help-btn help-btn--solid" onClick={closeSheet}>
              {t('help.close')}
            </button>
          </>
        )}
      </Sheet>
      {tour.status === 'running' && (
        <GuidedTour
          step={tour.step}
          onNext={() => dispatchTour({ type: 'next' })}
          onBack={() => dispatchTour({ type: 'back' })}
          onSkip={() => dispatchTour({ type: 'skip' })}
        />
      )}
    </aside>
  );
}
