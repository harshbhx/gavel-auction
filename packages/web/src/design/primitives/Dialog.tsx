import { useCallback, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../../a11y/useFocus';
import './primitives.css';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** When true, Esc does not close the dialog. The user must use an explicit action. */
  readonly strict?: boolean;
  readonly title: string;
  readonly children: ReactNode;
}

export function Dialog({ open, onClose, strict = false, title, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { active: open });

  const onBackdropClick = useCallback((): void => {
    if (!strict) onClose();
  }, [onClose, strict]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Escape' && !strict) {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose, strict],
  );

  if (!open) return null;

  return (
    <div
      className="gv-dialog-backdrop"
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="gv-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
