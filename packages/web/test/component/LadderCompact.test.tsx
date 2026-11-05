import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LadderCompact } from '../../src/ladder/LadderCompact';
import { hold, settlementView } from '../../src/testing/scenarios/_kit';

const settled = (() => {
  const holds = [hold(1, 'Ana', 50_000, 'CAPTURED', 30_000, 20_000)];
  for (let paddle = 2; paddle <= 12; paddle += 1) {
    holds.push(hold(paddle, `P${paddle}`, 10_000, 'SETTLED', 0, 10_000));
  }
  return settlementView('SETTLED', 1, holds);
})();

describe('LadderCompact', () => {
  it('shows one dot per hold and the count summary', () => {
    const { container } = render(<LadderCompact view={settled} />);
    expect(container.querySelectorAll('li').length).toBe(12);
    expect(screen.getByText('1 captured, 11 released')).toBeTruthy();
  });

  it('uses a different shape for each state class', () => {
    const view = settlementView('CAPTURING', 1, [
      hold(1, 'Ana', 50_000, 'CAPTURED', 30_000),
      hold(2, 'Bo', 10_000, 'SETTLED', 0, 10_000),
      hold(3, 'Cy', 10_000, 'FAILED_NEEDS_REVIEW'),
      hold(4, 'Di', 10_000, 'HELD'),
    ]);
    const { container } = render(<LadderCompact view={view} />);
    const shape = (kind: string): string | undefined =>
      container.querySelector(`li[data-kind="${kind}"] svg`)?.innerHTML;
    const shapes = ['captured', 'released', 'review', 'open'].map(shape);
    expect(shapes.every((s) => s !== undefined)).toBe(true);
    expect(new Set(shapes).size).toBe(4);
  });

  it('gives assistive tech the state in text and hides the shapes', () => {
    const { container } = render(<LadderCompact view={settled} />);
    const first = container.querySelector('li');
    expect(first?.getAttribute('aria-label')).toBe('1 Charged');
    expect(container.querySelector('li svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('never says charged or released before the server does', () => {
    const view = settlementView('BIDDING', null, [hold(1, 'Ana', 10_000, 'BIDDING')]);
    render(<LadderCompact view={view} />);
    expect(screen.queryByText(/captured|released/)).toBeNull();
  });

  it('waits quietly before the first settlement update', () => {
    render(<LadderCompact view={null} />);
    expect(screen.getByRole('status').textContent).toBe('Waiting for settlement');
  });
});
