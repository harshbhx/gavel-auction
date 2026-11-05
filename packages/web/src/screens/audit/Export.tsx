import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { toCsv, type CsvCell } from '../../util/csv';
import { canonicalJson, sha256Hex } from '../../util/hash';
import { formatUsd } from '../../util/money';
import type { AuditPayload } from '../../wire';

export type ExportRow = Record<string, string | number | boolean | null>;

export interface ExportHeader {
  roomId: string;
  lotId: string;
  exportedAt: string;
  rowCount: number;
  /** SHA-256 of the canonical JSON of the rows only; null when the browser cannot hash. */
  sha256: string | null;
  /** True when the browser only held part of the trail, so rows are missing from this file. */
  truncated: boolean;
  firstSeq: number | null;
  lastSeq: number | null;
}

export interface ExportFile {
  name: string;
  mime: string;
  content: string;
}

export const ROW_COLUMNS = [
  'seq',
  'serverTsIso',
  'serverTsMs',
  'audioTsMs',
  'transcript',
  'paddle',
  'parsedAmountCents',
  'parsedAmountUsd',
  'confidence',
  'confirmed',
  'source',
  'outcome',
  'reason',
] as const;

/** One audit row as flat export cells. Amounts are integer cents plus a formatted column; times are ISO 8601 UTC and epoch ms. */
export function toExportRow(
  row: AuditPayload,
  paddleOf: (bidderId: string) => number | null,
): ExportRow {
  const cents = row.parsedAmount === undefined ? null : Number(row.parsedAmount);
  const ms = Number(row.serverTs);
  return {
    seq: row.seq,
    serverTsIso: new Date(ms).toISOString(),
    serverTsMs: ms,
    audioTsMs: row.audioTsMs ?? null,
    transcript: row.transcript ?? null,
    paddle: paddleOf(row.bidderId),
    parsedAmountCents: cents,
    parsedAmountUsd: cents === null ? null : formatUsd(cents),
    confidence: row.confidence ?? null,
    confirmed: row.confirmed ?? null,
    source: row.source,
    outcome: row.outcome,
    reason: row.reason ?? null,
  };
}

function safeName(part: string): string {
  const cleaned = part.replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned === '' ? 'x' : cleaned;
}

export function exportFileName(roomId: string, lotId: string, ext: 'csv' | 'json'): string {
  return `gavel-${safeName(roomId)}-${safeName(lotId)}-audit.${ext}`;
}

export interface BuildExportInput {
  roomId: string;
  lotId: string;
  rows: readonly AuditPayload[];
  paddleOf: (bidderId: string) => number | null;
  format: 'csv' | 'json';
  now: number;
  subtle?: SubtleCrypto | null;
  /** The rows come from a trail that is known to be incomplete. */
  truncated?: boolean;
}

export async function buildExport(input: BuildExportInput): Promise<ExportFile> {
  const rows = input.rows.map((r) => toExportRow(r, input.paddleOf));
  const hash =
    input.subtle === undefined
      ? await sha256Hex(canonicalJson(rows))
      : await sha256Hex(canonicalJson(rows), input.subtle);
  const header: ExportHeader = {
    roomId: input.roomId,
    lotId: input.lotId,
    exportedAt: new Date(input.now).toISOString(),
    rowCount: rows.length,
    sha256: hash,
    truncated: input.truncated === true,
    firstSeq: input.rows.length === 0 ? null : Math.min(...input.rows.map((r) => r.seq)),
    lastSeq: input.rows.length === 0 ? null : Math.max(...input.rows.map((r) => r.seq)),
  };
  const name = exportFileName(input.roomId, input.lotId, input.format);
  if (input.format === 'json') {
    return {
      name,
      mime: 'application/json',
      content: JSON.stringify({ header, rows }, null, 2),
    };
  }
  const headerKeys = Object.keys(header);
  const cells: CsvCell[][] = [
    headerKeys,
    headerKeys.map((k) => header[k as keyof ExportHeader]),
    [],
    [...ROW_COLUMNS],
    ...rows.map((r) => ROW_COLUMNS.map((c) => r[c])),
  ];
  return { name, mime: 'text/csv;charset=utf-8', content: toCsv(cells) };
}

function download(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ExportProps {
  roomId: string;
  lotId: string;
  filteredRows: readonly AuditPayload[];
  allRows: readonly AuditPayload[];
  paddleOf: (bidderId: string) => number | null;
  /** True when the room store dropped or never received older rows (`auditTruncated`). */
  truncated?: boolean;
  now?: () => number;
  /** Receives the built file; the default saves it in the browser. */
  onFile?: (file: ExportFile) => void;
}

/** Browser-only export of the filtered rows or the full trail. Nothing is uploaded. */
export function Export({
  roomId,
  lotId,
  filteredRows,
  allRows,
  paddleOf,
  truncated = false,
  now = Date.now,
  onFile = download,
}: ExportProps) {
  const run = (rows: readonly AuditPayload[], format: 'csv' | 'json'): void => {
    void buildExport({ roomId, lotId, rows, paddleOf, format, now: now(), truncated }).then(onFile);
  };
  return (
    <div className="gv-audit-export">
      <Button variant="outline" onClick={() => run(filteredRows, 'csv')}>
        {t('audit.export.csvFiltered')}
      </Button>
      <Button variant="outline" onClick={() => run(filteredRows, 'json')}>
        {t('audit.export.jsonFiltered')}
      </Button>
      <Button variant="outline" onClick={() => run(allRows, 'csv')}>
        {t(truncated ? 'audit.export.csvRecent' : 'audit.export.csvAll')}
      </Button>
      <Button variant="outline" onClick={() => run(allRows, 'json')}>
        {t(truncated ? 'audit.export.jsonRecent' : 'audit.export.jsonAll')}
      </Button>
    </div>
  );
}
