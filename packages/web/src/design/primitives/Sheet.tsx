import { useCallback, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../../a11y/useFocus';
import './primitives.css';

export interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { active: open });

  const onBackdropClick = useCallback((): void => {
    onClose();
  }, [onClose]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="gv-sheet-backdrop"
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="gv-sheet"
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
