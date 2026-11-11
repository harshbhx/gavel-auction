import { useEffect } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { ActionGroup } from '../../design/primitives/ActionGroup';
import { Button } from '../../design/primitives/Button';
import { Sheet } from '../../design/primitives/Sheet';
import { formatUsd } from '../../util/money';

/**
 * How the lot ended for this person: they won it, they bid and lost, they only watched (or never
 * held a limit), or nobody won it.
 */
export type EndOutcome = 'won' | 'lost' | 'sold' | 'noSale';

export interface EndDialogProps {
  outcome: EndOutcome;
  /** The lot title, or null when the room has none. */
  lotTitle: string | null;
  /** The hammer price in cents; 0 when there was no sale. */
  amountCents: number;
  /** The paddle that won, when the room says it and it is not this bidder. */
  winnerPaddle?: number | null;
  /** Routes to the start page. */
  onHome: () => void;
  /** Routes to the join entry with the code field focused. */
  onJoinCode: () => void;
  /** Opens the receipt; given only where this bidder has one. */
  onReceipt?: (() => void) | undefined;
  /** Dismisses the pop-up and stays on the bid screen. */
  onClose: () => void;
}

/** Whether a receipt exists for this ending: the bidder held a limit and the lot sold. */
export function hasReceipt(outcome: EndOutcome): boolean {
  return outcome === 'won' || outcome === 'lost';
}

function kickerOf(outcome: EndOutcome): string {
  if (outcome === 'won') return t('bid.status.won');
  if (outcome === 'lost') return t('bid.status.lost');
  return t('bid.closedBanner');
}

function copyOf(
  outcome: EndOutcome,
  lotTitle: string | null,
  amount: string,
  winnerPaddle: number | null,
): { title: string; lines: string[]; announce: string } {
  if (outcome === 'won') {
    return {
      title: t('win.title'),
      lines: [
        lotTitle === null ? t('win.price', { amount }) : t('win.lot', { lot: lotTitle, amount }),
        t('win.money', { amount }),
      ],
      announce: t('end.announce', { amount }),
    };
  }
  if (outcome === 'noSale') {
    return {
      title: t('end.title.noSale'),
      lines: [
        lotTitle === null ? t('end.noSale.body') : t('end.noSale.lot', { lot: lotTitle }),
        t('end.noSale.hold'),
      ],
      announce: t('end.announce.noSale'),
    };
  }
  const sold =
    lotTitle === null
      ? t('end.sold.price', { amount })
      : t('end.sold.lot', { lot: lotTitle, amount });
  const lines = [
    winnerPaddle === null ? sold : `${sold} ${t('end.sold.paddle', { n: winnerPaddle })}`,
  ];
  if (outcome === 'lost') lines.push(t('end.money.lost'));
  return {
    title: outcome === 'lost' ? t('end.title.lost') : t('end.title.sold'),
    lines,
    announce: t(outcome === 'lost' ? 'end.announce.lost' : 'end.announce.sold', { amount }),
  };
}

/**
 * The pop-up everyone in the room sees once, when the lot ends: the winner, a bidder who lost, a
 * watcher, and anyone when it closes with no sale. Every ending offers Join room and Go home; the
 * receipt link shows only where a receipt exists. It is a modal dialog (focus trap, Escape and
 * backdrop close come from Sheet) and is spoken through the live region. It adds no motion.
 */
export function EndDialog({
  outcome,
  lotTitle,
  amountCents,
  winnerPaddle = null,
  onHome,
  onJoinCode,
  onReceipt,
  onClose,
}: EndDialogProps) {
  const amount = formatUsd(amountCents);
  const copy = copyOf(outcome, lotTitle, amount, winnerPaddle);
  const spoken = copy.announce;
  useEffect(() => {
    announce('assertive', spoken, 'summary');
  }, [spoken]);

  const showReceipt = hasReceipt(outcome) && onReceipt !== undefined;
  const [lead, ...rest] = copy.lines;
  return (
    <Sheet open onClose={onClose} title={copy.title}>
      <div className="bid-win" data-testid="end-dialog" data-outcome={outcome}>
        <p className="bid-win__kicker">{kickerOf(outcome)}</p>
        <h2 className="bid-win__title">{copy.title}</h2>
        {outcome !== 'noSale' && <p className="bid-win__amount">{amount}</p>}
        <p className="bid-win__lot">{lead}</p>
        {rest.map((line) => (
          <p key={line} className="bid-win__money">
            {line}
          </p>
        ))}
        <ActionGroup>
          <Button size="bid" onClick={onJoinCode}>
            {t('end.join')}
          </Button>
          <Button size="bid" variant="outline" onClick={onHome}>
            {t('end.home')}
          </Button>
          {showReceipt && (
            <Button size="bid" variant="text" onClick={onReceipt}>
              {t('win.receipt')}
            </Button>
          )}
        </ActionGroup>
        <Button variant="text" onClick={onClose}>
          {t('generic.close')}
        </Button>
      </div>
    </Sheet>
  );
}
