import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../../src/ui/ui.css'), 'utf8');

describe('ceiling slider in forced colors (#2392)', () => {
  const forced = css.slice(css.lastIndexOf('@media (forced-colors: active)'));

  it('keeps fill, ticks and knob visible with system colours', () => {
    expect(forced).toMatch(
      /\.ui-slider__fill\s*{[^}]*forced-color-adjust: none;[^}]*background: Highlight;/,
    );
    expect(forced).toMatch(
      /\.ui-slider__tick,\s*\.ui-slider__tick--major\s*{[^}]*background: CanvasText;/,
    );
    expect(forced).toMatch(
      /\.ui-slider__knob\s*{[^}]*background: CanvasText;[^}]*border: 2px solid Highlight;/,
    );
  });

  it('never leaves a slider part on a background-only paint', () => {
    for (const part of ['fill', 'tick', 'knob']) {
      expect(forced).toContain(`.ui-slider__${part}`);
    }
  });
});
