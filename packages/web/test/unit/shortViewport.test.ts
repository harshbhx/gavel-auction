import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const css = read('../../src/design/short-viewport.css');

describe('short and narrow viewport rules (landscape phones, 360 px)', () => {
  it('compacts the fixed and sticky bars under 480 px tall', () => {
    const short = css.slice(css.indexOf('@media (max-height: 480px)'));
    for (const selector of ['.gv-mk-header', '.gv-sticky-cta', '.gv-judge__bar']) {
      expect(short).toContain(selector);
    }
    expect(short).toContain('position: static;');
  });

  it('has a 360 px rule for the judge bar', () => {
    expect(css).toContain('@media (max-width: 380px)');
  });

  it('uses tokens for colour and spacing', () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
    expect(/\brgba?\(/.test(css)).toBe(false);
  });

  it('keeps a vh fallback and uses dvh for the judge page', () => {
    const source = read('../../src/screens/judge/judge.css');
    expect(source).toMatch(/100vh;\s*\n\s*min-height: 100dvh;/);
  });
});
