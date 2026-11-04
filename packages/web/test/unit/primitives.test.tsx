import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../src/design/primitives/Button';
import { Chip } from '../../src/design/primitives/Chip';
import { Field } from '../../src/design/primitives/Field';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const css = read('../../src/design/primitives/primitives.css');
const tokens = read('../../src/design/tokens.css');
const themes = read('../../src/design/themes.css');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return '';
  return css.slice(start, css.indexOf('}', start));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function token(source: string, block: RegExp, name: string): string {
  const body = block.exec(source)?.[1] ?? '';
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body)?.[1] ?? '';
}

describe('Button', () => {
  it('has a 48 px minimum for the bid size and 40 px for the default size', () => {
    expect(rule('.gv-btn--bid')).toContain('min-height: 48px');
    expect(rule('.gv-btn--bid')).toContain('min-width: 48px');
    expect(rule('.gv-btn')).toContain('min-height: 40px');
    render(
      <>
        <Button size="bid">One</Button>
        <Button>Two</Button>
      </>,
    );
    expect(screen.getByText('One').getAttribute('data-size')).toBe('bid');
    expect(screen.getByText('Two').getAttribute('data-size')).toBe('default');
  });

  it('exposes disabled as aria-disabled, keeps focus, and blocks clicks', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onClick when enabled and defaults to type button', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
  });

  it('is keyboard focusable', () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole('button');
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe('focus ring', () => {
  it('is 2 px wide on controls', () => {
    expect(rule('.gv-btn:focus-visible,\n.gv-input:focus-visible')).toContain(
      'outline: 2px solid var(--color-focus)',
    );
  });

  it.each([
    ['light', tokens, /:root \{([\s\S]*?)\n\}/],
    ['dark', themes, /:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/],
    ['projector', themes, /:root\[data-theme='projector'\] \{([\s\S]*?)\n\}/],
  ])('has at least 3:1 contrast against the %s background', (_theme, source, block) => {
    const focus = token(source, block, '--color-focus');
    const bg = token(source, block, '--color-bg');
    expect(focus).not.toBe('');
    expect(bg).not.toBe('');
    expect(contrast(focus, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('Chip', () => {
  it('always renders the icon and the label', () => {
    render(<Chip state="outbid" label="Outbid" icon={<svg data-testid="icon" />} />);
    expect(screen.getByText('Outbid')).toBeTruthy();
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes the machine state and tone as data attributes', () => {
    const { container } = render(
      <Chip state="CAPTURED" label="Charged" icon={<svg />} tone="success" />,
    );
    const chip = container.querySelector('.gv-chip');
    expect(chip?.getAttribute('data-state')).toBe('CAPTURED');
    expect(chip?.getAttribute('data-tone')).toBe('success');
  });
});

describe('Field', () => {
  it('links the label to the input', () => {
    render(<Field label="Display name" />);
    expect(screen.getByLabelText('Display name').tagName).toBe('INPUT');
  });

  it('wires hint and error through aria-describedby', () => {
    render(<Field label="Paddle" hint="Pick a number" error="Taken" />);
    const input = screen.getByLabelText('Paddle');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(['Pick a number', 'Taken']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Taken');
  });

  it('has no description or invalid flag when there is neither hint nor error', () => {
    render(<Field label="Paddle" />);
    const input = screen.getByLabelText('Paddle');
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('passes input props through', () => {
    render(<Field label="Amount" inputMode="numeric" defaultValue="5" />);
    const input = screen.getByLabelText('Amount');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect((input as HTMLInputElement).value).toBe('5');
  });
});
