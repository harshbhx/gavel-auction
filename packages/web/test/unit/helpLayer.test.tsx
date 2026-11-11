import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { HelpLayer } from '../../src/help';
import { helpReducer } from '../../src/help/helpState';

describe('help sheet state', () => {
  it('opens the menu, the hold explainer and closes', () => {
    expect(helpReducer('closed', { type: 'openMenu' })).toBe('menu');
    expect(helpReducer('menu', { type: 'openHold' })).toBe('hold');
    expect(helpReducer('hold', { type: 'close' })).toBe('closed');
  });
});

describe('HelpLayer', () => {
  it('opens the hold explainer from the help button and closes with Escape', () => {
    render(<HelpLayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'What is a hold?' }));
    expect(screen.getByText('Hatched: held')).toBeTruthy();
    expect(screen.getByText('Solid: charged only if you win')).toBeTruthy();
    expect(screen.getByText('Hollow: released')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open anything by itself', () => {
    render(<HelpLayer />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem('gavel.tour.v1')).toBeNull();
  });

  it('has no axe violations with the explainer open', async () => {
    const { container } = render(<HelpLayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'What is a hold?' }));
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});

describe('HelpLayer quick answers (UIX-52)', () => {
  it('lists short answers next to the hold explainer', () => {
    render(<HelpLayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByText('Is real money moved?')).toBeTruthy();
    expect(screen.getByText('How does voice work?')).toBeTruthy();
    expect(screen.getByText('What if my phone dies?')).toBeTruthy();
  });
});
