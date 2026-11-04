import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from '../../src/design/primitives/Banner';
import { Button } from '../../src/design/primitives/Button';
import { Chip } from '../../src/design/primitives/Chip';
import { Dialog } from '../../src/design/primitives/Dialog';
import { Field } from '../../src/design/primitives/Field';
import { Sheet } from '../../src/design/primitives/Sheet';

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
    expect(css).toContain('.gv-btn:focus-visible,');
    expect(css).toContain('.gv-input:focus-visible,');
    expect(css).toContain('outline: 2px solid var(--color-focus)');
    expect(css).toContain('outline-offset: 2px');
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

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open={false} onClose={onClose} title="Test">
        Content
      </Dialog>,
    );
    expect(container.querySelector('.gv-dialog')).toBeNull();
    expect(screen.queryByText('Content')).toBeNull();
  });

  it('renders content when open and has dialog role', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirm">
        <button>OK</button>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Confirm');
    expect(screen.getByText('OK')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Test">
        <button>OK</button>
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when strict', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Test" strict>
        <button>OK</button>
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Test">
        <button>OK</button>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on backdrop click when strict', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Test" strict>
        <button>OK</button>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when clicking inside the dialog panel', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Test">
        <button>OK</button>
      </Dialog>,
    );
    fireEvent.click(screen.getByText('OK'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('traps focus inside the dialog', () => {
    render(
      <div>
        <button>Outside</button>
        <Dialog open onClose={vi.fn()} title="Trap">
          <button>First</button>
          <button>Second</button>
        </Dialog>
      </div>,
    );
    const first = screen.getByText('First');
    const second = screen.getByText('Second');
    expect(document.activeElement).toBe(first);
    second.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('restores focus to trigger on close', () => {
    const Wrapper = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Restore">
            <button>Inside</button>
          </Dialog>
        </>
      );
    };
    // Need React for useState
    render(<Wrapper />);
    const trigger = screen.getByText('Open');
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Sheet open={false} onClose={vi.fn()} title="Test">
        Content
      </Sheet>,
    );
    expect(container.querySelector('.gv-sheet')).toBeNull();
  });

  it('renders content when open with dialog role', () => {
    render(
      <Sheet open onClose={vi.fn()} title="Bid">
        <button>OK</button>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Bid');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Test">
        <button>OK</button>
      </Sheet>,
    );
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click but not on panel click', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Test">
        <button>OK</button>
      </Sheet>,
    );
    fireEvent.click(screen.getByText('OK'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Banner', () => {
  it('renders with info tone and icon', () => {
    const { container } = render(
      <Banner tone="info" icon={<svg data-testid="icon" />}>
        Reconnecting
      </Banner>,
    );
    const banner = container.querySelector('.gv-banner');
    expect(banner?.getAttribute('data-tone')).toBe('info');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(screen.getByText('Reconnecting')).toBeTruthy();
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders warn tone', () => {
    const { container } = render(
      <Banner tone="warn" icon={<svg />}>
        Paused
      </Banner>,
    );
    expect(container.querySelector('.gv-banner')?.getAttribute('data-tone')).toBe('warn');
  });

  it('renders danger tone', () => {
    const { container } = render(
      <Banner tone="danger" icon={<svg />}>
        Stopped
      </Banner>,
    );
    expect(container.querySelector('.gv-banner')?.getAttribute('data-tone')).toBe('danger');
  });

  it('has CSS rules for all three tones', () => {
    expect(css).toContain(".gv-banner[data-tone='info']");
    expect(css).toContain(".gv-banner[data-tone='warn']");
    expect(css).toContain(".gv-banner[data-tone='danger']");
  });
});
