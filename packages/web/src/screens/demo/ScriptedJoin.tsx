import { useEffect, useRef } from 'react';
import { t } from '../../copy/t';
import { Provenance } from '../../design/Provenance';
import { SCRIPTED_BID_PATH, SCRIPTED_DEMO_PATH } from '../../net/scriptedMode';
import '../flows.css';
import '../hub/hub.css';

/** Where the QR of the scripted demo screen lands: an honest page, not an empty one. */
export function ScriptedJoin() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = t('scriptedJoin.title');
    heading.current?.focus();
  }, []);
  return (
    <main className="gv-flow" data-route="scripted-join">
      <p className="ui-kicker">{t('app.name')}</p>
      <h1 ref={heading} tabIndex={-1}>
        {t('scriptedJoin.title')}
      </h1>
      <Provenance kind="scripted" />
      <p>{t('scriptedJoin.lead')}</p>
      <a className="gv-flow__action" href={SCRIPTED_BID_PATH}>
        {t('scriptedJoin.bidder')}
      </a>
      <a className="gv-flow__action gv-flow__action--plain" href={SCRIPTED_DEMO_PATH}>
        {t('scriptedJoin.screen')}
      </a>
      <div className="gv-help">
        <p>{t('scriptedJoin.liveHint')}</p>
        <a className="gv-flow__action" href="/demo">
          {t('scriptedJoin.live')}
        </a>
      </div>
    </main>
  );
}

export default ScriptedJoin;
