import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { t } from '../copy/t';
import { prefersReducedMotion } from './format';

export const HOLD_MS = 3000;
const TICK_MS = 50;
const ARM_MS = 5000;

export type HoldPhase = 'idle' | 'holding' | 'done' | 'cancelled' | 'armed';

export interface HoldButtonProps {
  /** Called once when the hold completes, or when the confirm alternative is used. */
  onConfirm: () => void;
  label: string;
  /** Short line under the label. */
  hint?: string;
  /** How long the press must last. Default 3000 ms. */
  holdMs?: number;
  /** Exposed as aria-disabled; the control stays focusable. */
  disabled?: boolean;
  /** Shown as a line under the button while it is disabled, so it never fails silently. */
  disabledReason?: string;
  /** Offers two taps for people who cannot hold. Default true. */
  confirmAlternative?: boolean;
  /** Red variant for destructive confirms such as stopping the auction. Same hold, same keys. */
  tone?: 'default' | 'danger';
  id?: string;
}

function secondsLeft(ms: number, elapsed: number): number {
  return Math.max(1, Math.ceil((ms - elapsed) / 1000));
}

/** Press and hold (pointer, or Space and Enter) with a progress ring. Release cancels. */
export function HoldButton({
  onConfirm,
  label,
  hint,
  holdMs = HOLD_MS,
  disabled = false,
  disabledReason,
  confirmAlternative = true,
  tone = 'default',
  id,
}: HoldButtonProps) {
  const [phase, setPhase] = useState<HoldPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [left, setLeft] = useState(secondsLeft(holdMs, 0));
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const active = useRef(false);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const noteId = useId();

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const clearArm = useCallback(() => {
    if (armTimer.current !== null) clearTimeout(armTimer.current);
    armTimer.current = null;
  }, []);

  useEffect(
    () => () => {
      stopTimer();
      clearArm();
    },
    [stopTimer, clearArm],
  );

  const cancel = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    stopTimer();
    setProgress(0);
    setLeft(secondsLeft(holdMs, 0));
    setPhase('cancelled');
  }, [holdMs, stopTimer]);

  const start = useCallback(() => {
    if (disabled || active.current || phase === 'done') return;
    clearArm();
    active.current = true;
    startedAt.current = Date.now();
    setPhase('holding');
    setProgress(0);
    setLeft(secondsLeft(holdMs, 0));
    const reduced = prefersReducedMotion();
    timer.current = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      if (elapsed >= holdMs) {
        active.current = false;
        stopTimer();
        setProgress(1);
        setPhase('done');
        onConfirmRef.current();
        return;
      }
      setLeft(secondsLeft(holdMs, elapsed));
      // Reduced motion: the ring moves in whole-second steps instead of continuously.
      setProgress(reduced ? Math.floor(elapsed / 1000) / (holdMs / 1000) : elapsed / holdMs);
    }, TICK_MS);
  }, [disabled, phase, holdMs, stopTimer, clearArm]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) start();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    cancel();
  };

  const confirmByTaps = (): void => {
    if (disabled || phase === 'done') return;
    if (phase === 'armed') {
      clearArm();
      setProgress(1);
      setPhase('done');
      onConfirmRef.current();
      return;
    }
    setPhase('armed');
    clearArm();
    armTimer.current = setTimeout(() => {
      setPhase('idle');
    }, ARM_MS);
  };

  const seconds = Math.round(holdMs / 1000);
  const holdingText =
    left === 1 ? t('ui.hold.statusHoldingOne') : t('ui.hold.statusHoldingMany', { left });
  const status =
    phase === 'holding'
      ? holdingText
      : phase === 'done'
        ? t('ui.hold.statusDone')
        : phase === 'cancelled'
          ? t('ui.hold.statusCancelled')
          : phase === 'armed'
            ? t('ui.hold.statusArmed')
            : '';

  return (
    <div className="ui-hold" data-phase={phase}>
      <button
        type="button"
        id={id}
        className="ui-hold__btn"
        data-phase={phase}
        data-tone={tone}
        aria-disabled={disabled ? true : undefined}
        aria-describedby={noteId}
        style={{ '--ui-hold-p': progress } as CSSProperties}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          start();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={cancel}
        onClick={(e) => {
          e.preventDefault();
        }}
      >
        <svg className="ui-hold__ring" viewBox="0 0 40 40" aria-hidden="true">
          <circle className="ui-hold__track" cx="20" cy="20" r="16" />
          <circle className="ui-hold__fill" cx="20" cy="20" r="16" pathLength="100" />
        </svg>
        <span className="ui-hold__text">
          <span className="ui-hold__label">{label}</span>
          {hint !== undefined && <small>{hint}</small>}
        </span>
      </button>
      {disabled && disabledReason !== undefined && (
        <span className="ui-hold__reason" role="status">
          {disabledReason}
        </span>
      )}
      <span className="ui-hold__note" id={noteId}>
        {t('ui.hold.note', { seconds })}
      </span>
      {confirmAlternative && (
        <button
          type="button"
          className="ui-hold__alt"
          aria-disabled={disabled ? true : undefined}
          onClick={confirmByTaps}
        >
          {phase === 'armed' ? t('ui.hold.altArmed') : t('ui.hold.alt')}
        </button>
      )}
      <span className="ui-hold__status" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
