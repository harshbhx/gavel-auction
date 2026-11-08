import { en } from '../../copy/en';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { redactDetail, shortRef } from './redact';
import { STATES_TABLE, type DataView } from './statesTable';
import { Logo } from '../../design/Logo';
import './states.css';

export interface StateProps {
  view: DataView;
}

/** Placeholder rows with a text label, so a long wait never shows a bare spinner. */
export function Loading({ view, rows = 3 }: StateProps & { rows?: number }) {
  return (
    <div className="gv-state gv-state--loading" role="status" aria-busy="true">
      <Logo variant="mark" height={32} decorative className="gv-logo--pulse" />
      <span>{en[STATES_TABLE[view].loading]}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="gv-skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

export function Empty({ view }: StateProps) {
  return (
    <p className="gv-state gv-state--empty" role="status">
      {en[STATES_TABLE[view].empty]}
    </p>
  );
}

export function Offline({ view }: StateProps) {
  return (
    <p className="gv-state gv-state--offline" role="status">
      {en[STATES_TABLE[view].offline]}
    </p>
  );
}

export interface ErrorPanelProps extends StateProps {
  onRetry: () => void;
  /** Raw error code, shown in Details after redaction. */
  code: string;
  /** Correlation id; only its last 8 characters are shown. */
  correlationId: string;
}

/** Human message, a retry action and a collapsible Details with the code and reference (R-WEB-107). */
export function ErrorPanel({ view, onRetry, code, correlationId }: ErrorPanelProps) {
  return (
    <div className="gv-state gv-state--error" role="alert">
      <p>{en[STATES_TABLE[view].error]}</p>
      <Button onClick={onRetry}>{t('state.retry')}</Button>
      <details>
        <summary>{t('state.details')}</summary>
        <p>{t('err.details', { code: redactDetail(code), ref: shortRef(correlationId) })}</p>
      </details>
    </div>
  );
}
