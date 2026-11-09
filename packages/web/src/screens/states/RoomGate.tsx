import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { t } from '../../copy/t';
import { clearAuctioneerToken } from '../../store/session';
import { forgetHubRoom } from '../hub/hubKeys';
import { ApiError, apiErrorFor, unreachable } from '../../net/apiError';
import { ApiProblem, type ApiProblemKind } from './ApiProblem';
import '../flows.css';

type Check = { kind: 'checking' } | { kind: 'ok' } | { kind: 'problem'; error: ApiError };

export interface RoomGateProps {
  /** Server base; none means there is no network to ask, so the page shows as is. */
  readonly apiBase: string | undefined;
  readonly roomId: string;
  readonly onNavigate: (path: string) => void;
  readonly children: ReactNode;
}

/** Shows its page only when the server knows the room; otherwise says why it cannot. */
export function RoomGate({ apiBase, roomId, onNavigate, children }: RoomGateProps) {
  const [check, setCheck] = useState<Check>(
    apiBase === undefined ? { kind: 'ok' } : { kind: 'checking' },
  );
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (apiBase === undefined) return undefined;
    let live = true;
    setCheck({ kind: 'checking' });
    fetch(`${apiBase}/api/auctions/${encodeURIComponent(roomId)}`)
      .then(
        (res): Check => (res.ok ? { kind: 'ok' } : { kind: 'problem', error: apiErrorFor(res) }),
        (): Check => ({ kind: 'problem', error: unreachable() }),
      )
      .then((next) => {
        // The room ended or expired: its keys must not outlive it in this tab.
        if (next.kind === 'problem' && next.error.kind === 'notFound') {
          clearAuctioneerToken(roomId);
          forgetHubRoom(roomId);
        }
        if (live) setCheck(next);
      });
    return () => {
      live = false;
    };
  }, [apiBase, roomId, attempt]);
  if (check.kind === 'ok') return <>{children}</>;
  if (check.kind === 'checking') {
    return (
      <main className="gv-flow" aria-busy="true">
        <h1 tabIndex={-1}>{t('app.name')}</h1>
        <p role="status" className="gv-join__help">
          {t('join.loading')}
        </p>
      </main>
    );
  }
  const kind: ApiProblemKind =
    check.error.kind === 'notFound'
      ? 'notFound'
      : check.error.kind === 'rateLimited'
        ? 'rateLimited'
        : 'unreachable';
  return (
    <ApiProblem
      kind={kind}
      retryAfterS={check.error.retryAfterS}
      onNavigate={onNavigate}
      onRetry={retry}
    />
  );
}

export default RoomGate;
