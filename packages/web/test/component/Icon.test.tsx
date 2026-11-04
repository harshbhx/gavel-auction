import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ICON_PATHS, Icon, type IconName } from '../../src/design/icons';

const NAMES = Object.keys(ICON_PATHS) as IconName[];

describe('Icon', () => {
  it('provides the required icon set', () => {
    expect([...NAMES].sort()).toEqual(
      [
        'check',
        'hollow',
        'current',
        'warning',
        'mic',
        'qr',
        'keyboard',
        'hand',
        'lock',
        'clock',
        'stop',
        'play',
        'pause',
      ].sort(),
    );
  });

  it.each(NAMES)('%s renders inline SVG hidden from assistive technology by default', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.querySelector('title')).toBeNull();
    expect(svg?.children.length).toBeGreaterThan(0);
  });

  it('exposes a title as an image role with an accessible name', () => {
    const { container } = render(<Icon name="check" title="Held" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.querySelector('title')?.textContent).toBe('Held');
  });

  it('escapes markup in the title', () => {
    const { container } = render(<Icon name="check" title="<b>x</b>" />);
    expect(container.querySelector('svg b')).toBeNull();
    expect(container.querySelector('title')?.textContent).toBe('<b>x</b>');
  });

  it('draws on currentColor and loads nothing from the network', () => {
    const { container } = render(<Icon name="lock" />);
    expect(container.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
    expect(container.innerHTML).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
