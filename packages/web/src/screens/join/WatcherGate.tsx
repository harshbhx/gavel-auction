import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import '../flows.css';

export interface WatcherGateProps {
  readonly roomId: string;
  /** Moves the app to another path. */
  readonly onNavigate: (path: string) => void;
}

/**
 * What a person sees on the bid or receipt page of a room they have not joined: they can watch
 * the public screen's story elsewhere, and from here they can join as a bidder in one step.
 */
export function WatcherGate({ roomId, onNavigate }: WatcherGateProps) {
  const id = encodeURIComponent(roomId);
  return (
    <main className="gv-flow" data-route="watcher" data-state="not-joined">
      <p className="ui-kicker">{t('app.name')}</p>
      <h1 tabIndex={-1}>{t('watch.title')}</h1>
      <p className="gv-join__help">{t('watch.lead')}</p>
      <p className="gv-join__note">{t('join.sandboxNote')}</p>
      <div className="gv-join__actions">
        <Button size="bid" onClick={() => onNavigate(`/r/${id}/register`)}>
          {t('join.asBidder')}
        </Button>
        <Button variant="outline" onClick={() => onNavigate(`/join/${id}`)}>
          {t('watch.openJoin')}
        </Button>
      </div>
    </main>
  );
}

export default WatcherGate;
