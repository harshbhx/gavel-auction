import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Export } from '../../src/screens/audit/Export';
import { bidId, bidderId } from '../../src/testing/builders';
import type { AuditPayload } from '../../src/wire';

const rows = [
  {
    bidId: bidId(1),
    bidderId: bidderId(1),
    source: 'manual',
    outcome: 'accepted',
    serverTs: 1_700_000_000_001,
    seq: 1,
  } as AuditPayload,
];
const paddleOf = (): number | null => 1;
const noop = (): void => undefined;
const props = { roomId: 'r1', lotId: 'l1', filteredRows: rows, allRows: rows, paddleOf };

describe('audit export labels (R13-WB11)', () => {
  it('calls the all-rows export the full trail when nothing is missing', () => {
    render(<Export {...props} onFile={noop} />);
    expect(screen.getByText('CSV, full trail')).toBeTruthy();
  });

  it('stops calling it the full trail when older rows are missing', () => {
    render(<Export {...props} truncated onFile={noop} />);
    expect(screen.queryByText('CSV, full trail')).toBeNull();
    expect(screen.queryByText('JSON, full trail')).toBeNull();
    expect(screen.getAllByText(/older rows missing/)).toHaveLength(2);
  });
});
