import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from '../../src/design/Logo';

describe('Logo', () => {
  it('is named GAVEL for assistive technology', () => {
    render(<Logo />);
    expect(screen.getByRole('img', { name: 'GAVEL' })).toBeTruthy();
  });

  it('sets a fixed width and height so nothing shifts', () => {
    render(<Logo variant="wordmark" height={22} />);
    const svg = screen.getByRole('img', { name: 'GAVEL' });
    expect(svg.getAttribute('height')).toBe('22');
    expect(svg.getAttribute('width')).toBe('99');
  });

  it('hides a decorative logo from assistive technology', () => {
    const { container } = render(<Logo variant="mark" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the orange mallet head in all three variants', () => {
    for (const variant of ['mark', 'wordmark', 'lockup'] as const) {
      const { container, unmount } = render(<Logo variant={variant} />);
      expect(container.querySelectorAll('.gv-logo__head').length).toBeGreaterThan(0);
      unmount();
    }
  });
});
