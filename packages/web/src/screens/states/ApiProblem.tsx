import { useEffect, useRef } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { waitText } from '../../net/apiError';
import '../flows.css';

export type ApiProblemKind = 'notFound' | 'rateLimited' | 'unreachable';

export interface ApiProblemProps {
  readonly kind: ApiProblemKind;
  /** Seconds the server asked the client to wait, for a rate limit. */
  readonly retryAfterS?: number | null;
  /** Moves the app to another path. */
  readonly onNavigate: (path: string) => void;
  /** Tries the request again. Defaults to reloading the page. */
  readonly onRetry?: () => void;
}

/** A room page that cannot load: missing or ended, slowed down by the server, or no network. */
export function ApiProblem({ kind, retryAfterS = null, onNavigate, onRetry }: ApiProblemProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [kind]);
  const retry = onRetry ?? (() => window.location.reload());
  const title =
    kind === 'notFound'
      ? t('room.missingTitle')
      : kind === 'rateLimited'
        ? t('join.rateTitle')
        : t('join.offlineTitle');
  const help =
    kind === 'notFound'
      ? t('room.missingHelp')
      : kind === 'rateLimited'
        ? retryAfterS === null
          ? t('api.rateHelpUnknown')
          : t('api.rateHelp', { wait: waitText(retryAfterS) })
        : t('api.offlineHelp');
  return (
    <main className="gv-flow" data-route="room-problem" data-state={kind}>
      <p className="ui-kicker">{t('app.name')}</p>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      <p role="alert" className="gv-join__help">
        {help}
      </p>
      <div className="gv-join__actions">
        {kind === 'notFound' ? (
          <>
            <Button size="bid" onClick={() => onNavigate('/')}>
              {t('join.tryAgain')}
            </Button>
            <Button variant="outline" onClick={() => onNavigate('/try')}>
              {t('join.startDemo')}
            </Button>
          </>
        ) : (
          <Button size="bid" onClick={retry}>
            {t('generic.retry')}
          </Button>
        )}
      </div>
    </main>
  );
}

export default ApiProblem;
