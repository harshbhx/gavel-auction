/**
 * A CSV file name that says which room and when: `gavel-ledger-ab12cd-20261109T101530Z`.
 * The grid adds the `.csv` extension. The room id is cut down to letters, digits, `-` and `_`.
 */
export function exportBaseName(kind: string, roomId: string): string {
  const room = roomId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
  return `gavel-${kind}-${room === '' ? 'room' : room}`;
}

/** `20261109T101530Z`, the UTC time of an export. */
export function exportStamp(at: Date = new Date()): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}
