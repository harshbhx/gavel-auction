// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRID_COLORS } from '../../src/grid/theme';

const tokens = readFileSync(new URL('../../src/design/tokens.css', import.meta.url), 'utf8');
const light = /:root \{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';

function token(name: string): string | undefined {
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`).exec(light)?.[1]?.toLowerCase();
}

describe('AG Grid theme colours', () => {
  it('match the light Newsprint tokens, so the grid and the page never drift apart', () => {
    expect(GRID_COLORS.surface).toBe(token('--color-surface'));
    expect(GRID_COLORS.raised).toBe(token('--color-raised'));
    expect(GRID_COLORS.rule).toBe(token('--color-rule'));
    expect(GRID_COLORS.fg).toBe(token('--color-fg'));
    expect(GRID_COLORS.muted).toBe(token('--color-fg-muted'));
    expect(GRID_COLORS.border).toBe(token('--color-border'));
    expect(GRID_COLORS.accent).toBe(token('--color-accent'));
    expect(GRID_COLORS.danger).toBe(token('--color-danger'));
    expect(GRID_COLORS.success).toBe(token('--color-success'));
    expect(GRID_COLORS.action).toBe(token('--color-action'));
  });
});
