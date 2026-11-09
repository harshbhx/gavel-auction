import { useEffect, useRef } from 'react';
import { NotFound } from './NotFound';
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
  /**
   * Tries the request again. Defaults to reloading the page. When given, a rate limit also retries
   * by itself once the server's Retry-After has passed (up to AUTO_RETRY_MAX_S).
   */
  readonly onRetry?: () => void;
}

/** A rate limit shorter than this retries on its own; a long lockout waits for the button. */
const AUTO_RETRY_MAX_S = 120;
/** Wait used when the server sent no Retry-After. */
const AUTO_RETRY_DEFAULT_S = 5;

/** A room page that cannot load: missing or ended, slowed down by the server, or no network. */
export function ApiProblem({ kind, retryAfterS = null, onRetry }: ApiProblemProps) {
  if (kind === 'notFound') return <NotFound kind="room" />;
  return <ApiRetry kind={kind} retryAfterS={retryAfterS} onRetry={onRetry} />;
}

function ApiRetry({
  kind,
  retryAfterS,
  onRetry,
}: {
  readonly kind: 'rateLimited' | 'unreachable';
  readonly retryAfterS: number | null;
  readonly onRetry: (() => void) | undefined;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [kind]);
  const retry = onRetry ?? (() => window.location.reload());
  const autoS = retryAfterS ?? AUTO_RETRY_DEFAULT_S;
  const auto = kind === 'rateLimited' && onRetry !== undefined && autoS <= AUTO_RETRY_MAX_S;
  useEffect(() => {
    if (!auto || onRetry === undefined) return undefined;
    const timer = window.setTimeout(onRetry, autoS * 1000);
    return () => window.clearTimeout(timer);
  }, [auto, autoS, onRetry]);
  const title = kind === 'rateLimited' ? t('join.rateTitle') : t('join.offlineTitle');
  const help =
    kind === 'rateLimited'
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
        <Button size="bid" onClick={retry}>
          {t('generic.retry')}
        </Button>
      </div>
    </main>
  );
}

export default ApiProblem;
