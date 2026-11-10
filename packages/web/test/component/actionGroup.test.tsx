import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import { ActionGroup } from '../../src/design/primitives/ActionGroup';
import { Button } from '../../src/design/primitives/Button';
import { JoinScreen } from '../../src/screens/join/JoinScreen';

describe('button group (UIX-45)', () => {
  it('keeps child order and renders plain buttons without adding a role', () => {
    render(
      <ActionGroup data-testid="group">
        <Button>One</Button>
        <Button variant="outline">Two</Button>
        <Button variant="text">Three</Button>
      </ActionGroup>,
    );
    const group = screen.getByTestId('group');
    expect(group.className).toContain('gv-actions');
    expect(group.getAttribute('role')).toBeNull();
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['One', 'Two', 'Three']);
    expect(screen.getByRole('button', { name: 'Three' }).className).toContain('gv-btn--text');
  });

  it('puts the join choices in one group: PayPal, demo, then just watch', async () => {
    const { container } = render(
      <JoinScreen
        roomId="room1"
        roomName="Gala"
        shortCode="ABC123"
        state="open"
        origin="https://gavel.example"
        onNavigate={() => undefined}
        hasSession={false}
        demoHold
      />,
    );
    const group = container.querySelector('.gv-actions');
    expect(group).not.toBeNull();
    const labels = within(group as HTMLElement)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual([t('join.wayDemo'), t('join.wayPaypal'), t('join.watch')]);
    const ways = screen.getByRole('region', { name: t('join.waysTitle') });
    expect(ways.contains(group)).toBe(true);
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
      resultTypes: ['violations'],
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
