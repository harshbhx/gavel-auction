import type { ICellRendererParams } from 'ag-grid-community';

import { t } from '../copy/t';
import { Icon, type IconName } from '../design/icons';
import { Chip, type ChipTone } from '../design/primitives/Chip';
import { formatUsd } from '../util/money';
import { STATUS_ICON, STATUS_LABEL, STATUS_TONE, actorLabel, typeLabel, typeTone } from './labels';
import { formatStamp, shortHash, type ChainStatus, type LedgerEntry } from './ledgerModel';

export type LedgerRow = LedgerEntry & {
  status: ChainStatus | 'checking';
  /** Set by a "Verify chain" run once it has reached this row. */
  checked?: boolean;
};

export function StatusChip({ status }: { status: LedgerRow['status'] }) {
  if (status === 'checking') {
    return (
      <Chip
        state="checking"
        label={t('ledger.status.checking')}
        icon={<Icon name="clock" size={14} />}
      />
    );
  }
  return (
    <Chip
      state={status}
      label={STATUS_LABEL[status]()}
      icon={<Icon name={STATUS_ICON[status]} size={14} />}
      tone={STATUS_TONE[status]}
    />
  );
}

export function TypeChip({ type }: { type: string }) {
  return (
    <Chip
      state={type}
      label={typeLabel(type)}
      icon={<Icon name="current" size={14} />}
      tone={typeTone(type)}
    />
  );
}

export function statusCell(p: ICellRendererParams<LedgerRow>) {
  return p.data === undefined ? null : <StatusChip status={p.data.status} />;
}

export function typeCell(p: ICellRendererParams<LedgerRow>) {
  return p.data === undefined ? null : <TypeChip type={p.data.type} />;
}

/** One card per row for narrow screens: number, event, time, who, amount, hash and chain status. */
export function cardCell(p: ICellRendererParams<LedgerRow>) {
  const row = p.data;
  if (row === undefined) return null;
  return (
    <div className="gv-card">
      <div className="gv-card__top">
        <span className="gv-grid-num gv-card__seq">{row.seq}</span>
        <TypeChip type={row.type} />
        <time className="gv-grid-num" dateTime={new Date(row.at).toISOString()}>
          {formatStamp(row.at)}
        </time>
      </div>
      <div className="gv-card__mid">
        <span>{actorLabel(row.actor)}</span>
        <span className="gv-grid-num">
          {row.amountCents === null ? '' : formatUsd(row.amountCents)}
        </span>
      </div>
      <div className="gv-card__bot">
        <code className="gv-grid-num">{shortHash(row.hash)}</code>
        <StatusChip status={row.status} />
      </div>
    </div>
  );
}

/** Word-and-icon marker, never colour alone. */
export function Mark({ icon, tone, text }: { icon: IconName; tone: ChipTone; text: string }) {
  return <Chip state={text} label={text} icon={<Icon name={icon} size={14} />} tone={tone} />;
}
