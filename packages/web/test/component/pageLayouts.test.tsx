import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { JudgeHub } from '../../src/screens/hub/JudgeHub';
import { NO_KEYS } from '../../src/screens/hub/hubKeys';
import { NotFound } from '../../src/screens/states/NotFound';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// UIX-56: hub, 404 and landing button rows use the shared ActionGroup.
describe('page layouts (UIX-56)', () => {
  it('404: one primary link, the other links are text links in the same group', () => {
    const { container } = render(<NotFound />);
    const groups = container.querySelectorAll('.gv-actions');
    expect(groups).toHaveLength(1);
    const links = within(groups[0] as HTMLElement).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([t('nf.demo'), t('nf.judges'), t('nf.docs')]);
    expect(links[0]?.className).not.toContain('gv-flow__action--text');
    expect(links[1]?.className).toContain('gv-flow__action--text');
    expect(links[2]?.className).toContain('gv-flow__action--text');
  });

  it('404 for a missing room keeps the primary first and adds one outline link', () => {
    render(<NotFound kind="room" />);
    expect(screen.getByRole('link', { name: t('join.tryAgain') }).className).toContain(
      'gv-flow__action--outline',
    );
  });

  it('hub: every action row is an ActionGroup and no row is a loose flex wrap', () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined));
    const { container } = render(
      <JudgeHub
        roomId="room-1"
        keys={{ ...NO_KEYS, auctioneer: 'tok', screen: null }}
        apiBase="http://api.test"
        origin="https://gavel.test"
        navigate={() => undefined}
      />,
    );
    expect(container.querySelector('.gv-hub__row')).toBeNull();
    const copyButtons = container.querySelectorAll('.gv-btn');
    expect(copyButtons.length).toBeGreaterThan(3);
    for (const b of Array.from(copyButtons)) {
      if (b.closest('dialog, [role="dialog"]') !== null) continue;
      expect(b.parentElement?.className).toContain('gv-actions');
    }
  });
});
