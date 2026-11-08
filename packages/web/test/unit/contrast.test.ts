// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_PAIRS, MIN_RATIO, THEMES, type ThemeName } from '../../src/design/pairs';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const tokens = read('../../src/design/tokens.css');
const themes = read('../../src/design/themes.css');

function declarations(block: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of (block ?? '').matchAll(/(--color-[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) out.set(name, value);
  }
  return out;
}

function palette(theme: ThemeName): Map<string, string> {
  if (theme === 'light') return declarations(/:root \{([\s\S]*?)\n\}/.exec(tokens)?.[1]);
  return declarations(
    new RegExp(`:root\\[data-theme='${theme}'\\] \\{([\\s\\S]*?)\\n\\}`).exec(themes)?.[1],
  );
}

function channel(byte: number): number {
  const c = byte / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('contrast ratio helper', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe.each(THEMES)('theme %s', (theme) => {
  const colors = palette(theme);

  it('declares every colour used by a pair', () => {
    for (const pair of COLOR_PAIRS) {
      expect(colors.has(pair.fg), `${theme} ${pair.fg}`).toBe(true);
      expect(colors.has(pair.bg), `${theme} ${pair.bg}`).toBe(true);
    }
  });

  it.each(COLOR_PAIRS.map((p) => [p.fg, p.bg, p] as const))(
    '%s on %s meets its minimum',
    (_fg, _bg, pair) => {
      const fg = colors.get(pair.fg);
      const bg = colors.get(pair.bg);
      expect(fg).toBeDefined();
      expect(bg).toBeDefined();
      const ratio = contrastRatio(fg ?? '#000000', bg ?? '#000000');
      expect(ratio).toBeGreaterThanOrEqual(MIN_RATIO[pair.kind]);
    },
  );
});

describe('text never equals its background', () => {
  const sets: [string, Map<string, string>][] = [
    ...THEMES.map((t): [string, Map<string, string>] => [t, palette(t)]),
  ];

  it.each(sets)('%s', (_name, colors) => {
    for (const pair of COLOR_PAIRS) {
      expect(colors.get(pair.fg), `${pair.fg} on ${pair.bg}`).not.toBe(colors.get(pair.bg));
    }
  });
});
