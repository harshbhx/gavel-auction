import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/ports.ts', import.meta.url), 'utf8');

describe('ports.ts (T-RT-021)', () => {
  it('does not contain function declarations, const, let, var, or class', () => {
    expect(source).not.toMatch(/^export (function|const|let|var|class) /m);
    expect(source).not.toMatch(/^(function|const|let|var|class) /m);
  });

  it('contains only import type statements, not value imports', () => {
    const imports = source.match(/^import .+/gm) ?? [];
    for (const imp of imports) {
      expect(imp, `value import found: ${imp}`).toMatch(/^import type /);
    }
  });

  it('exports all required port interfaces', () => {
    expect(source).toContain('export interface RoomStore');
    expect(source).toContain('export interface PaymentsPort');
    expect(source).toContain('export interface EnginePort');
    expect(source).toContain('export interface Logger');
    expect(source).toContain('export interface TokenSigner');
  });

  it('exports supporting types', () => {
    expect(source).toContain('export interface HammerOutcome');
    expect(source).toContain('export type TokenKind');
    expect(source).toContain('export interface TokenClaims');
  });

  it('has no executable export statements', () => {
    const exports = (source.match(/^export /gm) ?? []).length;
    const typeExports = (source.match(/^export (interface|type) /gm) ?? []).length;
    expect(exports).toBe(typeExports);
  });
});
