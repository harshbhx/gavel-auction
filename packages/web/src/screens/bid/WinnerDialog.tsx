import { useEffect } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { ActionGroup } from '../../design/primitives/ActionGroup';
import { Button } from '../../design/primitives/Button';
import { Sheet } from '../../design/primitives/Sheet';
import { formatUsd } from '../../util/money';

export interface WinnerDialogProps {
  /** The lot title, or null when the room has none. */
  lotTitle: string | null;
  /** The hammer price in cents. */
  amountCents: number;
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
  onHome,
  onJoinCode,
  onReceipt,
  onClose,
}: WinnerDialogProps) {
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
        <ActionGroup>
          <Button size="bid" onClick={onHome}>
            {t('win.home')}
          </Button>
          <Button size="bid" variant="outline" onClick={onJoinCode}>
            {t('win.joinCode')}
          </Button>
          <Button size="bid" variant="text" onClick={onReceipt}>
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
