import { useSyncExternalStore, type CSSProperties } from 'react';
import { appAnnouncer, type AnnouncerCore } from './announce';

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export interface AnnouncerProps {
  /** Defaults to the app-wide announcer. Tests pass their own. */
  core?: AnnouncerCore;
}

/** Mount once near the root. Owns the two live regions (R-WEB-110). */
export function Announcer({ core = appAnnouncer }: AnnouncerProps) {
  const state = useSyncExternalStore(core.subscribe, core.getState, core.getState);
  return (
    <div style={visuallyHidden}>
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="live-polite">
        {state.polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" data-testid="live-assertive">
        {state.assertive}
      </div>
    </div>
  );
}
