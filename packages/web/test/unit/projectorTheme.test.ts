// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/design/themes.css', import.meta.url), 'utf8');
const block = /:root\[data-theme='projector'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

function token(name: string): string {
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? '';
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

describe('projector theme', () => {
  it('is the cream and ink look: a light page and surface under dark text', () => {
    expect(luminance(token('--color-bg'))).toBeGreaterThan(0.8);
    expect(luminance(token('--color-surface'))).toBeGreaterThan(0.8);
    expect(luminance(token('--color-fg'))).toBeLessThan(0.2);
  });

  it('keeps the screen stylesheet free of hard-coded colours', () => {
    const screenCss = readFileSync(
      new URL('../../src/screens/screen/screen.css', import.meta.url),
      'utf8',
    );
    expect(screenCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
