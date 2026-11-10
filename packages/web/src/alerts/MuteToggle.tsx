import { t } from '../copy/t';
import { Button } from '../design/primitives/Button';
import { alertEngine, type AlertEngine } from './engine';
import { useAlertsMuted } from './useAlerts';

export interface MuteToggleProps {
  engine?: AlertEngine;
}

/** Turns alert sound and vibration off or on. Announcements for screen readers are unaffected. */
export function MuteToggle({ engine = alertEngine() }: MuteToggleProps) {
  const muted = useAlertsMuted(engine);
  return (
    <>
      <Button
        variant="outline"
        tone="neutral"
        aria-pressed={muted}
        data-testid="alerts-mute"
        onClick={() => {
          // The click is the gesture that lets the browser start audio.
          engine.unlock();
          engine.setMuted(!muted);
        }}
      >
        {muted ? t('alerts.unmute') : t('alerts.mute')}
      </Button>
      <span className="gv-mute__state" data-testid="alerts-state">
        {muted ? t('alerts.stateOff') : t('alerts.stateOn')}
      </span>
    </>
  );
}
