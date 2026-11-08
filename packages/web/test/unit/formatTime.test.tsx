import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReceiptTime } from '../../src/screens/receipt/ReceiptTime';
import { formatTime, formatTimeUtc } from '../../src/ui/format';

const AT = Date.UTC(2023, 10, 14, 22, 13, 25, 123);

describe('receipt time', () => {
  it('formats in the viewer locale without raw ISO or milliseconds', () => {
    const text = formatTime(AT, 'en-GB');
    expect(text).toMatch(/14 Nov 2023/);
    expect(text).not.toMatch(/T\d\d:\d\d|\.123|Z$/);
    expect(formatTime(AT, 'en-US')).toMatch(/Nov 14, 2023/);
  });

  it('formats the UTC time with its zone name', () => {
    expect(formatTimeUtc(AT, 'en-GB')).toBe('14 Nov 2023, 22:13:25 UTC');
  });

  it('keeps the ISO value in dateTime and UTC in title and name', () => {
    const { container } = render(<ReceiptTime at={AT} />);
    const el = container.querySelector('time');
    expect(el?.getAttribute('dateTime')).toBe('2023-11-14T22:13:25.123Z');
    expect(el?.getAttribute('title')).toBe(formatTimeUtc(AT));
    expect(el?.getAttribute('aria-label')).toContain(formatTimeUtc(AT));
    expect(el?.textContent).toBe(formatTime(AT));
  });
});
