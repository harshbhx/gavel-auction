import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Body of the first rule whose selector line is exactly `selector`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('projection screen layout (UIX-55)', () => {
  const css = read('../../src/screens/screen/screen.css');

  it('grows with its content instead of cutting it off', () => {
    const root = rule(css, '.gv-screen');
    expect(root).toContain('min-height: calc(100dvh - var(--gv-chrome, 0px))');
    expect(root).not.toMatch(/\n\s*height:/);
    expect(root).not.toMatch(/overflow:\s*hidden/);
    expect(rule(css, '.gv-screen__side')).not.toContain('overflow');
  });

  it('collapses to one column on phones and small tablets', () => {
    const at = css.indexOf('@media (max-width: 899px)');
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at);
    expect(block).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(block).toMatch(/gv-story__step\s*{\s*flex-basis: 100%/);
  });

  it('sizes the price from its card and the QR code from the screen height', () => {
    expect(rule(css, '.gv-screen__board')).toContain('container-type: inline-size');
    expect(css).toMatch(/gv-screen__price\s*{[^}]*14cqw/);
    expect(rule(css, '.gv-screen__join svg')).toContain('clamp(');
    expect(rule(css, '.gv-screen__head')).toContain('flex-wrap: nowrap');
  });

  it('keeps the hub preview a fixed 1920 x 1080 projector grid', () => {
    expect(css).toContain('.gv-screen:not(.gv-screen--preview)');
    expect(rule(css, '.gv-screen--preview')).toContain('--sv: 10.8px');
  });

  it('extends the bidder state ground below the room', () => {
    const bid = read('../../src/screens/bid/bid.css');
    expect(rule(bid, '.bid')).toContain('box-shadow: 0 100vh 0 0 var(--bid-bg)');
  });
});

describe('projection screen theme (UIX-62)', () => {
  const css = read('../../src/screens/screen/screen.css');
  const themes = read('../../src/design/themes.css');
  const tokens = read('../../src/design/tokens.css');
  const projector = /:root\[data-theme='projector'\] \{([\s\S]*?)\n\}/.exec(themes)?.[1] ?? '';
  const value = (block: string, name: string): string =>
    new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1]?.toLowerCase() ?? '';

  it('uses the cream paper and ink of the rest of the app, not black, navy or cyan', () => {
    const base = /:root \{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
    for (const name of ['--color-bg', '--color-surface', '--color-fg', '--color-action']) {
      expect(value(projector, name), name).toBe(value(base, name));
    }
    expect(value(projector, '--color-bg')).not.toBe('#000000');
    expect(projector).not.toMatch(/#0c1624|#132238|#1b2f4b|#8fd3b0|#8fa6c4/i);
  });

  it('keeps the large type scale for the room', () => {
    expect(projector).toContain('--type-scale: 2;');
  });

  it('draws the cards with the shared ink border, radius and shadow system', () => {
    for (const selector of ['.gv-screen__board', '.gv-screen__join']) {
      const body = rule(css, selector);
      expect(body, selector).toContain('border: var(--border-width-strong) solid var(--color-fg)');
      expect(body, selector).toContain('var(--radius-md)');
      expect(body, selector).toContain('var(--shadow-2)');
    }
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('shows the current step on the action colour with ink text', () => {
    const body = rule(css, ".gv-story__step[data-status='now']");
    expect(body).toContain('background: var(--color-action)');
    expect(body).toContain('color: var(--color-on-action)');
  });
});
