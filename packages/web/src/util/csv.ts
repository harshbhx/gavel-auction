export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@]/;

/** One RFC 4180 field. Text starting with = + - or @ gets a leading single quote to block spreadsheet formulas. */
export function csvField(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  let text = typeof cell === 'string' ? cell : String(cell);
  if (typeof cell === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Rows of cells to CSV text with CRLF line ends and no trailing line end. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}
