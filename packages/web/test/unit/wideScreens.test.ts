// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/screens/flows.css', import.meta.url), 'utf8');
const helpCss = readFileSync(new URL('../../src/help/help.css', import.meta.url), 'utf8');

/** The body of the FIX-66 wide-screen block, up to the phone block that follows it. */
const wide = css.slice(
  css.indexOf('Wide first screens (FIX-66)'),
  css.indexOf('The floating Help'),
);
const phone = css.slice(css.indexOf('The floating Help'));

describe('wide first screens (FIX-66)', () => {
  it('only applies from 1100px wide and in screen media, never in print', () => {
    expect(css).toContain('@media screen and (min-width: 1100px) and (min-height: 640px) {');
  });

  it('centres the one-column pages with a bounded measure', () => {
    expect(wide).toContain('main.gv-flow:not(:has(> .gv-aside))');
    expect(wide).toContain('max-width: 640px;');
    // Padding sets the page down; a viewport-high box could add a scrollbar.
    expect(wide).not.toContain('100vh');
    expect(wide).toContain('padding-block: clamp(');
  });

  it('gives gallery, replay, receipt and the ops key form a place on the wide screen', () => {
    for (const route of ['gallery', 'replay', 'receipt', 'ops']) {
      expect(wide).toContain(`main[data-route='${route}']`);
    }
  });

  it('keeps the landing, the judge panel, the audit page and the grid out of it', () => {
    for (const name of ['landing', 'judge', 'audit', 'grid', 'marquee']) {
      expect(wide).not.toContain(name);
    }
  });

  it('uses tokens for colour and spacing in the new rules', () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(wide + phone)).toBe(false);
    expect(/\brgba?\(/.test(wide + phone)).toBe(false);
  });

  it('reserves a band under the page for the floating Help button on phones', () => {
    expect(phone).toContain('@media (max-width: 839px)');
    expect(phone).toContain('body:has(.help-fab)');
    expect(phone).toContain('padding-bottom: calc(48px + var(--space-4) * 2);');
    // The band is the button's height plus its inset on both sides.
    expect(helpCss).toContain('bottom: var(--space-4);');
    expect(helpCss).toContain('min-height: 48px;');
    // The full-window pages do not scroll, so they keep no band.
    for (const route of ['screen', 'console', 'hub']) {
      expect(phone).toContain(`body:has(main[data-route='${route}'])`);
    }
  });

  it('shrinks the Help button to a round icon on phones, keeping its word for readers', () => {
    const fab = helpCss.slice(helpCss.indexOf('Phones: the button shrinks'));
    expect(fab).toContain('@media (max-width: 839px)');
    expect(fab).toContain('border-radius: 50%;');
    expect(fab).toContain("content: '?';");
  });
});
