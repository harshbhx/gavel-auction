import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import { ConsoleGuide } from '../../src/screens/console/ConsoleGuide';

describe('ConsoleGuide', () => {
  it('says the lot is ready and what to press next', () => {
    render(<ConsoleGuide status="SCHEDULED" stopped={false} roomId="lot-one" />);
    expect(screen.getByText(t('console.guide.state.scheduled'))).toBeTruthy();
    expect(screen.getByText(t('console.guide.next.scheduled'))).toBeTruthy();
  });

  it('links to the audit trail of the room', () => {
    render(<ConsoleGuide status="OPEN" stopped={false} roomId="lot one" />);
    const link = screen.getByRole('link', { name: t('console.guide.auditLink') });
    expect(link.getAttribute('href')).toBe('/r/lot%20one/audit');
  });

  it('shows stopped over any status and offers no link without a room', () => {
    render(<ConsoleGuide status="OPEN" stopped roomId={null} />);
    expect(screen.getByText(t('console.guide.state.stopped'))).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
