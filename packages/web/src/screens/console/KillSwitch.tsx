import { useEffect, useRef, useState } from 'react';
import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import { Dialog } from '../../design/primitives/Dialog';
import { Field } from '../../design/primitives/Field';
import { HoldButton } from './HammerDialog';

export const KILL_HOLD_MS = 1500;
export const KILL_PHRASE = 'STOP';

export interface KillSwitchProps {
  /** True once the room reported the stopped status. The stopped state is permanent. */
  readonly stopped: boolean;
  readonly onKill: () => void;
}

export function KillSwitch({ stopped, onKill }: KillSwitchProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
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
  return (
    <>
      <Button tone="danger" onClick={() => setOpen(true)}>
        {t('kill.button')}
      </Button>
      <Dialog open={open} onClose={close} title={t('kill.title')}>
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
          onComplete={() => {
            close();
            onKill();
          }}
        />
        <Button variant="outline" tone="neutral" onClick={close}>
          {t('common.cancel')}
        </Button>
      </Dialog>
    </>
  );
}
