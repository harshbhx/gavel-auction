import { useReducer } from 'react';
import { t } from '../copy/t';
import { Sheet } from '../design/primitives/Sheet';
import { HoldExplainer } from './HoldExplainer';
import { helpReducer } from './helpState';
import { Logo } from '../design/Logo';
import './help.css';

/**
 * One help button for the landing, join, registration, bidder room and receipt routes.
 * Opens the hold explainer sheet.
 */
export function HelpLayer() {
  const [view, dispatchView] = useReducer(helpReducer, 'closed');
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
            <Logo variant="wordmark" height={18} decorative />
            <h2 className="help-menu__title">{t('help.title')}</h2>
            <button
              type="button"
              className="help-btn help-btn--solid"
              onClick={() => dispatchView({ type: 'openHold' })}
            >
              {t('help.open.hold')}
            </button>
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
    </aside>
  );
}
