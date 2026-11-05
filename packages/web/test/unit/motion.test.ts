import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '../../src', rel), 'utf8');

describe('motion polish', () => {
  const tokens = read('design/tokens.css');
  const motion = read('design/motion.css');
  const ladder = read('ladder/ladder.css');

  it('hammer duration is 600ms and collapses to a static stamp under reduced motion', () => {
    expect(tokens).toContain('--duration-hammer: 600ms;');
    const reduced = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('--duration-hammer: 0ms;');
    expect(reduced).toContain('--hammer-static: 1;');
  });

  it('hammer stamp uses the hammer duration token', () => {
    expect(motion).toMatch(/animation:\s*gv-hammer-stamp var\(--duration-hammer\)/);
  });

  it('every animation is switched off under reduced motion', () => {
    const reduced = motion.slice(motion.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.gv-hammer-stamp');
    expect(reduced).toContain('.gv-price-tick');
    expect(reduced).toContain('animation: none');
    const ladderReduced = ladder.slice(ladder.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(ladderReduced).toContain('animation: none');
    expect(ladderReduced).toContain('transition: none');
  });

  it('keeps the stamp visible in forced colors', () => {
    const forced = motion.slice(motion.indexOf('@media (forced-colors: active)'));
    expect(forced).toContain('.gv-hammer-stamp');
    expect(forced).toContain('border: 2px solid CanvasText');
  });

  it('tokens pull in the motion sheet', () => {
    expect(tokens).toContain("@import './motion.css';");
  });
});
