import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { t } from '../../copy/t';
import { Button, type ButtonTone } from '../../design/primitives/Button';
import { Dialog } from '../../design/primitives/Dialog';
import { formatUsd } from '../../util/money';
import { HAMMER_HOLD_MS, HAMMER_HOLD_SECONDS } from './hammerHold';

export interface HoldButtonProps {
  readonly label: string;
  readonly holdMs: number;
  readonly tone?: ButtonTone;
  readonly disabled?: boolean;
  /** Fires once per completed hold, by pointer or by holding Enter. Never on a click or a tap of Enter. */
  readonly onComplete: () => void;
}

/**
 * Press-and-hold confirm. Releasing or leaving early cancels. Holding Enter on the focused button for the
 * same time is the keyboard alternative (R-WEB-113). A click or a tap of Enter never confirms.
 */
export function HoldButton({
  label,
  holdMs,
  tone = 'danger',
  disabled = false,
  onComplete,
}: HoldButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const cancel = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = (): void => {
    if (disabled) return;
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      completeRef.current();
    }, holdMs);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Key repeat must not restart the hold; only the first press starts it.
    if (e.repeat) return;
    start();
  };

  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter') cancel();
  };

  return (
    <Button
      tone={tone}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={cancel}
    >
      {label}
    </Button>
  );
}

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
          label={t('console.hammerHold')}
          holdMs={HAMMER_HOLD_MS}
          onComplete={onConfirm}
        />
      </div>
    </Dialog>
  );
}
