import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { t } from '../../copy/t';
import { Button, type ButtonTone } from '../../design/primitives/Button';
import { Dialog } from '../../design/primitives/Dialog';
import { formatUsd } from '../../util/money';

export const HAMMER_HOLD_MS = 800;

export interface HoldButtonProps {
  readonly label: string;
  readonly holdMs: number;
  readonly tone?: ButtonTone;
  readonly disabled?: boolean;
  /** Fires once per completed hold, or once per Enter press. Never on a plain click. */
  readonly onComplete: () => void;
}

/**
 * Press-and-hold confirm. Releasing or leaving early cancels. Enter on the focused button is the
 * keyboard alternative (R-WEB-113). A click alone never confirms.
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
    if (disabled || e.repeat) return;
    completeRef.current();
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
      <p>{question}</p>
      <p>{t('console.hammerHint')}</p>
      <HoldButton label={t('console.hammerHold')} holdMs={HAMMER_HOLD_MS} onComplete={onConfirm} />
      <Button variant="outline" tone="neutral" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </Dialog>
  );
}
