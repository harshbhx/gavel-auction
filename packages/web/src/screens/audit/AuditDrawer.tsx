import { useEffect, useRef } from 'react';

import { t } from '../../copy/t';
import type { AuditPayload } from '../../wire';

export interface AuditDrawerProps {
  /** The row to show, or null when the drawer is closed. */
  row: AuditPayload | null;
  onClose: () => void;
}

/** Row detail: the raw audit_event JSON exactly as received. */
export function AuditDrawer({ row, onClose }: AuditDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (row !== null) closeRef.current?.focus();
  }, [row]);

  if (row === null) return null;
  return (
    <aside
      role="dialog"
      aria-label={t('audit.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <pre data-testid="audit-json" tabIndex={0}>
        {JSON.stringify(row, null, 2)}
      </pre>
      <button ref={closeRef} type="button" onClick={onClose}>
        {t('generic.close')}
      </button>
    </aside>
  );
}
