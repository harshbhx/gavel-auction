// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  const font = (name: string): URL => new URL(`../../src/design/fonts/${name}`, import.meta.url);

  it('self-hosts Archivo and Martian Mono next to their licences', () => {
    expect(existsSync(font('archivo-latin-wdth-normal.woff2'))).toBe(true);
    expect(existsSync(font('martian-mono-latin-wght-normal.woff2'))).toBe(true);
    expect(existsSync(font('LICENSE-Archivo.txt'))).toBe(true);
    expect(existsSync(font('LICENSE-Martian-Mono.txt'))).toBe(true);
    expect(tokens).toContain("font-family: 'Archivo Variable'");
    expect(tokens).toContain("font-family: 'Martian Mono Variable'");
    expect(tokens).not.toMatch(/https?:\/\//);
  });

  it('keeps the two font files within the 140 KB budget', () => {
    const total = ['archivo-latin-wdth-normal.woff2', 'martian-mono-latin-wght-normal.woff2']
      .map((n) => statSync(font(n)).size)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(140 * 1024);
  });
});

describe('holdline tokens', () => {
  it('adds the state fills, easings and price sizes beside the old names', () => {
    for (const name of [
      '--hatch',
      '--ease-out',
      '--ease-in-out',
      '--ease-lock',
      '--font-size-price-screen',
      '--color-signal-ink',
      '--radius-sheet',
    ]) {
      expect(tokens, name).toContain(`${name}:`);
    }
  });

  it('never uses the brass fill colour as text or a line colour', () => {
    const css = [tokens, themes, read('../../src/design/holdline.css')].join('\n');
    expect(css).not.toMatch(/(?:^|[\s;{])(?:color|border-color)\s*:\s*var\(--color-signal\)/);
  });
});
