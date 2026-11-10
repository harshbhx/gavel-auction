import { useEffect, useState } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { ActionGroup } from '../../design/primitives/ActionGroup';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { Sheet } from '../../design/primitives/Sheet';
import { formatUsd } from '../../util/money';
import { isEmail, isPhone, saveWinnerDetails } from './winnerDetails';

export interface WinnerDialogProps {
  /** The lot title, or null when the room has none. */
  lotTitle: string | null;
  /** The hammer price in cents. */
  amountCents: number;
  /** The room id keys the details saved in this browser; null skips saving. */
  roomId: string | null;
  /** Routes to the start page. */
  onHome: () => void;
  /** Routes to the join entry with the code field focused. */
  onJoinCode: () => void;
  /** Opens the receipt. */
  onReceipt: () => void;
  /** Dismisses the pop-up and stays on the bid screen. */
  onClose: () => void;
}

/**
 * The pop-up the winning bidder sees once, when the lot closes in their favour. It is a modal
 * dialog (focus trap, Escape and backdrop close come from Sheet) and is spoken through the live
 * region. It adds no motion, so reduced-motion settings change nothing.
 */
export function WinnerDialog({
  lotTitle,
  amountCents,
  roomId,
  onHome,
  onJoinCode,
  onReceipt,
  onClose,
}: WinnerDialogProps) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emailErr, setEmailErr] = useState(false);
  const [phoneErr, setPhoneErr] = useState(false);
  const [saved, setSaved] = useState(false);

  /** Validates, writes to this browser only, then runs the action. Invalid input blocks both. */
  const commit = (next?: () => void): void => {
    const e = email.trim();
    const p = phone.trim();
    const badEmail = e !== '' && !isEmail(e);
    const badPhone = p !== '' && !isPhone(p);
    setEmailErr(badEmail);
    setPhoneErr(badPhone);
    if (badEmail || badPhone) return;
    if ((e !== '' || p !== '') && roomId !== null) {
      setSaved(saveWinnerDetails(roomId, e, p));
    }
    if (next !== undefined) next();
  };
  const amount = formatUsd(amountCents);
  useEffect(() => {
    announce('assertive', t('win.announce', { amount }), 'summary');
  }, [amount]);

  return (
    <Sheet open onClose={onClose} title={t('win.title')}>
      <div className="bid-win" data-testid="winner-dialog">
        <h2 className="bid-win__title">{t('win.title')}</h2>
        <p className="bid-win__lot">
          {lotTitle === null ? t('win.price', { amount }) : t('win.lot', { lot: lotTitle, amount })}
        </p>
        <p className="bid-win__money">{t('win.money', { amount })}</p>
        <div className="bid-win__fields">
          <Field
            label={t('win.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailErr(false);
              setSaved(false);
            }}
            {...(emailErr ? { error: t('win.emailError') } : {})}
          />
          <Field
            label={t('win.phone')}
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneErr(false);
              setSaved(false);
            }}
            {...(phoneErr ? { error: t('win.phoneError') } : {})}
          />
          <p className="bid-win__money">{t('win.local')}</p>
          <Button variant="outline" onClick={() => commit()}>
            {t('win.save')}
          </Button>
          {saved && <p role="status">{t('win.saved')}</p>}
        </div>
        <ActionGroup>
          <Button size="bid" onClick={() => commit(onHome)}>
            {t('win.home')}
          </Button>
          <Button size="bid" variant="outline" onClick={() => commit(onJoinCode)}>
            {t('win.joinCode')}
          </Button>
          <Button size="bid" variant="text" onClick={() => commit(onReceipt)}>
            {t('win.receipt')}
          </Button>
        </ActionGroup>
        <Button variant="text" onClick={onClose}>
          {t('generic.close')}
        </Button>
      </div>
    </Sheet>
  );
}
