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
  /** The hammer price in cents (0 when the lot closed with no bid). */
  amountCents: number;
  /** How the lot ended for this bidder. */
  outcome: 'won' | 'lost' | 'closed';
  /** Routes to the start page. */
  onHome: () => void;
  /** Routes to the join entry with the code field focused. */
  onJoinCode: () => void;
  /** Opens the receipt (the winner only). */
  onReceipt: () => void;
  /** Escape or a click outside dismisses the pop-up and stays on the bid screen. */
  onClose: () => void;
}

/**
 * The pop-up every bidder sees once when the lot closes; the winner also gets the win copy and the
 * receipt link. Two buttons, Join room and Go home, end it. It is a modal dialog (focus moves to
 * the first button, focus is trapped, Escape and backdrop close come from Sheet) and a win is
 * spoken through the live region. It adds no motion, so reduced-motion settings change nothing.
 */
export function WinnerDialog({
  lotTitle,
  amountCents,
  outcome,
  onHome,
  onJoinCode,
  onReceipt,
  onClose,
}: WinnerDialogProps) {
  const amount = formatUsd(amountCents);
  const won = outcome === 'won';
  useEffect(() => {
    if (won) announce('assertive', t('win.announce', { amount }), 'summary');
  }, [won, amount]);

  const title = won ? t('win.title') : t('bidEnd.title');
  let detail: string;
  if (won) {
    detail =
      lotTitle === null ? t('win.price', { amount }) : t('win.lot', { lot: lotTitle, amount });
  } else if (amountCents === 0) detail = t('bidEnd.noSale');
  else detail = t('bidEnd.closedAt', { amount });

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="bid-win" data-testid="winner-dialog">
        <h2 className="bid-win__title">{title}</h2>
        <p className="bid-win__lot">{detail}</p>
        <p className="bid-win__money">{won ? t('win.money', { amount }) : t('bidEnd.next')}</p>
        <ActionGroup>
          <Button size="bid" onClick={onJoinCode}>
            {t('win.joinCode')}
          </Button>
          <Button size="bid" variant="outline" onClick={onHome}>
            {t('win.home')}
          </Button>
        </ActionGroup>
        {won && (
          <Button variant="text" onClick={onReceipt}>
            {t('win.receipt')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
