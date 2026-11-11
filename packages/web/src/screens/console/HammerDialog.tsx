import { useState } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Dialog } from '../../design/primitives/Dialog';
import { HoldButton } from '../../ui';
import { formatUsd } from '../../util/money';
import { HAMMER_HOLD_MS, HAMMER_HOLD_SECONDS } from './hammerHold';

export interface HammerLeader {
  readonly paddle: number;
  readonly name: string;
}

export interface HammerDialogProps {
  readonly open: boolean;
  /** Null when there are no bids: the dialog asks to close with no sale. */
  readonly leader: HammerLeader | null;
  readonly priceCents: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function HammerDialog({ open, leader, priceCents, onConfirm, onCancel }: HammerDialogProps) {
  // A finished hold stays done; a new key makes it usable again if the dialog stays open.
  const [round, setRound] = useState(0);
  const question =
    leader === null
      ? t('console.hammerNoBids')
      : t('console.hammerConfirm', {
          amount: formatUsd(priceCents),
          n: leader.paddle,
          name: leader.name,
        });
  return (
    <Dialog open={open} onClose={onCancel} title={t('console.hammer')}>
      <div className="gv-console-dialog">
        <p>{question}</p>
        <p>{t('console.hammerHint', { s: HAMMER_HOLD_SECONDS })}</p>
        {/* Cancel comes first so the dialog focuses it, never the destructive control. */}
        <Button variant="outline" tone="neutral" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <HoldButton
          key={round}
          fill
          label={t('console.hammerHold')}
          holdMs={HAMMER_HOLD_MS}
          confirmAlternative={false}
          onConfirm={() => {
            onConfirm();
            setRound((n) => n + 1);
          }}
        />
      </div>
    </Dialog>
  );
}
