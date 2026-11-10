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
