import type { Page } from '@playwright/test';
import { expect, test } from '../src/fixtures/base';

/**
 * Public screen legibility (R-QA-037, T-QA-048): the price text is at least 96 px and the text
 * against its background is at least 7:1 in the projector theme.
 *
 * The screen needs a live room to render, so this reads computed styles from a probe built from
 * the screen's own classes (gv-screen and gv-screen__price) on the gallery page, which loads the
 * same stylesheet and theme tokens. It checks what the shipped CSS computes to; it does not
 * check the screen with room state in it.
 */

interface Reading {
  priceFontPx: number;
  baseFontPx: number;
  contrast: number;
  bg: string;
  fg: string;
}

async function readProbe(page: Page, webUrl: string, theme: string): Promise<Reading> {
  await page.addInitScript((value) => {
    document.documentElement.setAttribute('data-theme', value);
  }, theme);
  await page.goto(`${webUrl}/gallery`);
  await page.locator('h1').first().waitFor();
  return page.evaluate(() => {
    const parse = (value: string): [number, number, number] => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      const n = (m?.[1] ?? '0,0,0').split(/[ ,/]+/).filter((p) => p !== '');
      return [Number(n[0] ?? 0), Number(n[1] ?? 0), Number(n[2] ?? 0)];
    };
    const lum = (c: [number, number, number]): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const screen = document.createElement('div');
    screen.className = 'gv-screen';
    const price = document.createElement('p');
    price.className = 'gv-screen__price';
    price.textContent = '1';
    screen.appendChild(price);
    document.body.appendChild(screen);
    const s = getComputedStyle(screen);
    const p = getComputedStyle(price);
    const bg = parse(s.backgroundColor);
    const fg = parse(p.color);
    const a = lum(fg);
    const b = lum(bg);
    const result = {
      priceFontPx: parseFloat(p.fontSize),
      baseFontPx: parseFloat(s.fontSize),
      contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      bg: s.backgroundColor,
      fg: p.color,
    };
    screen.remove();
    return result;
  });
}

test('the price text is at least 96 px and the base text at least 28 px', async ({
  page,
  stack,
}) => {
  const reading = await readProbe(page, stack.webUrl, 'projector');
  expect(reading.priceFontPx).toBeGreaterThanOrEqual(96);
  expect(reading.baseFontPx).toBeGreaterThanOrEqual(28);
});

test('text against the background is at least 7:1 in the projector theme', async ({
  page,
  stack,
}) => {
  const reading = await readProbe(page, stack.webUrl, 'projector');
  expect(reading.contrast, `fg ${reading.fg} on bg ${reading.bg}`).toBeGreaterThanOrEqual(7);
});
