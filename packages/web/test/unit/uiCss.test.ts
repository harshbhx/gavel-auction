// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

describe('ui.css', () => {
  it('uses tokens only: no hex or rgb colours', () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
    expect(/\brgba?\(/.test(css)).toBe(false);
  });

  it('stops looping animation under reduced motion', () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? '';
    expect(block).toContain('animation: none;');
    expect(block).toContain('.ui-skeleton');
    expect(block).toContain('.ui-loader__dot');
  });
});
