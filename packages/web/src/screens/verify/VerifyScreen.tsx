import { useEffect, useRef, useState } from 'react';
import { VerifyPanel } from '../../chain/VerifyPanel';
import { t } from '../../copy/t';
import { latestHubRoom } from '../hub/hubKeys';
import { liveRoomFrom } from '../judge/liveRoom';
import '../flows.css';

export interface VerifyScreenProps {
  /** The API base, when the site has a server. */
  readonly apiBase?: string | undefined;
}

/** `/verify`: the verify area on a page of its own, for a judge who arrives with an export. */
export function VerifyScreen({ apiBase }: VerifyScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [room] = useState(() => liveRoomFrom(latestHubRoom()));
  useEffect(() => {
    document.title = t('verify.page.title');
    heading.current?.focus();
  }, []);
  return (
    <main className="gv-flow" data-route="verify">
      <p className="ui-kicker">{t('app.name')}</p>
      <h1 ref={heading} tabIndex={-1}>
        {t('verify.page.title')}
      </h1>
      <VerifyPanel
        room={
          room === null
            ? null
            : { roomId: room.roomId, reviewer: room.reviewer ?? null, audit: room.audit ?? null }
        }
        apiBase={apiBase}
        headingId="gv-verify-page-title"
      />
      <p>
        <a className="ui-link" href="/try">
          {t('verify.back')}
        </a>
      </p>
    </main>
  );
}

export default VerifyScreen;
