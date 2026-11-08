// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fontPreloadTags } from '../../vite.config';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const tokens = read('../../src/design/tokens.css');
const help = read('../../src/help/help.css');

describe('global reset (projector screen fits the viewport)', () => {
  it('zeroes the default html and body margin', () => {
    expect(tokens).toMatch(/html,\s*body\s*\{\s*margin:\s*0;\s*\}/);
  });
});

describe('help button reserves its own space (#2058)', () => {
  it('pads the page bottom and the scroll position by the button height plus both gaps', () => {
    const reserve = 'calc(48px + var(--space-4) * 2)';
    expect(help).toContain(`body:has(.help-layer) {\n  padding-bottom: ${reserve};`);
    expect(help).toContain(`html:has(.help-layer) {\n  scroll-padding-bottom: ${reserve};`);
  });
});

describe('web fonts: metric-matched fallbacks and preload (#2109)', () => {
  it('defines a size-adjusted fallback for each family and puts it right after the web font', () => {
    for (const name of ['Public Sans', 'Big Shoulders', 'JetBrains Mono']) {
      const block = new RegExp(`font-family: '${name} Fallback';[^}]*size-adjust: \\d+%;`);
      expect(tokens).toMatch(block);
    }
    expect(tokens).toContain("'Public Sans Variable', 'Public Sans Fallback'");
    expect(tokens).toContain("'Big Shoulders Display Variable', 'Big Shoulders Fallback'");
    expect(tokens).toContain("'JetBrains Mono Variable', 'JetBrains Mono Fallback'");
  });

  it('preloads only Public Sans and Big Shoulders, with the base and crossorigin', () => {
    const tags = fontPreloadTags(
      [
        'assets/index-abc.js',
        'assets/public-sans-latin-wght-normal-HASH1.woff2',
        'assets/big-shoulders-display-latin-wght-normal-HASH2.woff2',
        'assets/jetbrains-mono-latin-wght-normal-HASH3.woff2',
        'assets/inter-latin-wght-normal-HASH4.woff2',
      ],
      '/',
    );
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag).toContain('rel="preload"');
      expect(tag).toContain('as="font"');
      expect(tag).toContain('type="font/woff2"');
      expect(tag).toContain('crossorigin');
    }
    expect(tags.join('')).toContain('href="/assets/public-sans-latin-wght-normal-HASH1.woff2"');
    expect(fontPreloadTags(['assets/index-abc.js'], '/')).toEqual([]);
  });
});
