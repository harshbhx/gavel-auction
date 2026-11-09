import { useEffect, useRef, useState } from 'react';
import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import { Dialog } from '../../design/primitives/Dialog';
import { Field } from '../../design/primitives/Field';
import { HoldButton as DeskHold } from '../../ui';
import { HoldButton } from './HammerDialog';

export const KILL_HOLD_MS = 1500;
export const KILL_PHRASE = 'STOP';

export interface KillSwitchProps {
  /** True once the room reported the stopped status. The stopped state is permanent. */
  readonly stopped: boolean;
  /** A rejection is shown to the user: the kill route may be missing or refuse the request. */
  readonly onKill: () => void | Promise<void>;
}

export function KillSwitch({ stopped, onKill }: KillSwitchProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [failed, setFailed] = useState(false);
  // The desk hold stays done after it completes; a new key makes it usable again.
  const [holdRound, setHoldRound] = useState(0);
  const announced = useRef(false);

  useEffect(() => {
    if (stopped && !announced.current) {
      announced.current = true;
      announce('assertive', t('kill.stopped'), 'stop');
    }
  }, [stopped]);

  const close = (): void => {
    setOpen(false);
    setTyped('');
  };

  if (stopped) {
    return (
      <Banner tone="danger" icon={<Icon name="stop" />}>
        {t('kill.stopped')}
      </Banner>
    );
  }

  const ready = typed === KILL_PHRASE;
  const fire = (): void => {
    close();
    setFailed(false);
    try {
      const pending = onKill();
      if (pending instanceof Promise) pending.catch(() => setFailed(true));
    } catch {
      setFailed(true);
    }
  };
  return (
    <>
      <div className="gv-console-kill">
        <DeskHold
          key={holdRound}
          tone="danger"
          label={t('kill.deskHold')}
          hint={t('kill.deskHint')}
          confirmAlternative={false}
          onConfirm={() => {
            fire();
            setHoldRound((n) => n + 1);
          }}
        />
        <Button tone="danger" onClick={() => setOpen(true)}>
          {t('kill.button')}
        </Button>
        <p className="gv-console-hammer__alt">{t('kill.dialogHint')}</p>
      </div>
      {failed && <p role="alert">{t('kill.failed')}</p>}
      <Dialog open={open} onClose={close} title={t('kill.title')}>
        <div className="gv-console-dialog">
          <p>{t('kill.consequence')}</p>
          <Field
            label={t('kill.type')}
            type="text"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
          <p>{t('kill.holdHint')}</p>
          <HoldButton
            label={t('kill.hold')}
            holdMs={KILL_HOLD_MS}
            disabled={!ready}
            onComplete={fire}
          />
          <Button variant="outline" tone="neutral" onClick={close}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
