// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const tokens = read('../../src/design/tokens.css');
const themes = read('../../src/design/themes.css');

describe('design tokens', () => {
  it('defines the type scale 12/14/16/20/28/40 multiplied by --type-scale', () => {
    [12, 14, 16, 20, 28, 40].forEach((px, i) => {
      expect(tokens).toContain(`--font-size-${i + 1}: calc(${px}px * var(--type-scale));`);
    });
    expect(tokens).toContain('--line-height-body: 1.5;');
    expect(tokens).toContain('font-variant-numeric: tabular-nums;');
  });

  it('defines the motion tokens 120, 240 and 600 ms', () => {
    expect(tokens).toContain('--duration-micro: 120ms;');
    expect(tokens).toContain('--duration-standard: 240ms;');
    expect(tokens).toContain('--duration-hammer: 600ms;');
  });

  it('zeroes durations under reduced motion except an 80 ms opacity fade', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(tokens)?.[1];
    expect(block).toBeDefined();
    expect(block).toContain('--duration-micro: 0ms;');
    expect(block).toContain('--duration-standard: 0ms;');
    expect(block).toContain('--duration-hammer: 0ms;');
    expect(block).toContain('--duration-fade: 80ms;');
    expect(block).toContain('--hammer-static: 1;');
  });

  it('does not hard-code colours outside token declarations', () => {
    const outside = tokens.split('\n').filter((l) => /#[0-9a-fA-F]{3,8}\b/.test(l));
    expect(outside.every((l) => l.trim().startsWith('--color-'))).toBe(true);
  });
});

describe('themes', () => {
  it('provides dark and projector overrides selected by data-theme', () => {
    expect(themes).toContain(":root[data-theme='dark']");
    expect(themes).toContain(":root[data-theme='projector']");
  });

  it('follows prefers-color-scheme only when no data-theme is set', () => {
    expect(themes).toContain('@media (prefers-color-scheme: dark)');
    expect(themes).toContain(':root:not([data-theme])');
  });

  it('doubles the type scale on the projector theme', () => {
    const projector = /:root\[data-theme='projector'\] \{([\s\S]*?)\n\}/.exec(themes)?.[1];
    expect(projector).toContain('--type-scale: 2;');
  });

  it('overrides every colour token in each non-light theme', () => {
    const names = [...tokens.matchAll(/^\s+(--color-[a-z-]+):/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(8);
    const dark = /:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/.exec(themes)?.[1] ?? '';
    const projector = /:root\[data-theme='projector'\] \{([\s\S]*?)\n\}/.exec(themes)?.[1] ?? '';
    for (const name of names) {
      expect(dark, name).toContain(`${name}:`);
      expect(projector, name).toContain(`${name}:`);
    }
  });
});

describe('fonts', () => {
  it('self-hosts the variable font next to its licence', () => {
    expect(
      existsSync(new URL('../../src/design/fonts/inter-latin-wght-normal.woff2', import.meta.url)),
    ).toBe(true);
    expect(existsSync(new URL('../../src/design/fonts/LICENSE-Inter.txt', import.meta.url))).toBe(
      true,
    );
    expect(tokens).not.toMatch(/https?:\/\//);
  });
});
