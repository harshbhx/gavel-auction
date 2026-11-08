// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { check, dynamicImports, initialGraph, staticImports } from '../../scripts/check-size.mjs';

const CSP = "default-src 'self'; script-src 'self'; connect-src 'self' https://api.example.test";
const HTML = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"><script type="module" src="/assets/index-aaa.js"></script></head><body></body></html>`;

const made: string[] = [];

/** Size and lazy-chunk problems only: the CSP check depends on the VITE_* env of the test project. */
function sizeProblems(dir: string): string[] {
  return sizeProblems(dir).filter((p) => !p.startsWith('CSP'));
}

/** A fake dist: index.html plus the given chunk files under assets/. */
function dist(chunks: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-size-'));
  made.push(dir);
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), HTML);
  for (const [name, code] of Object.entries(chunks)) {
    writeFileSync(path.join(dir, 'assets', name), code);
  }
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ENTRY = 'import("./App-bbb.js").then(()=>{});import("./config-ccc.js");';

describe('check-size dynamic imports (initial route includes the App chunk)', () => {
  it('finds literal dynamic imports and ignores static ones', () => {
    expect(dynamicImports('import("./a.js");import{x}from"./b.js";import(foo)')).toEqual([
      './a.js',
    ]);
  });

  it('reads minified static imports with no space before from', () => {
    const code = 'import{a as b}from"./x.js";export{c}from"./y.js";import"./z.js";';
    expect(staticImports(code)).toEqual(['./x.js', './y.js', './z.js']);
  });

  it('counts the App chunk that the entry loads with import()', () => {
    const dir = dist({
      'index-aaa.js': ENTRY,
      'App-bbb.js': 'export const app = 1;'.repeat(50),
      'config-ccc.js': 'export const c = 1;',
    });
    const files = [...initialGraph(dir, HTML).keys()];
    expect(files).toEqual(
      expect.arrayContaining(['assets/index-aaa.js', 'assets/App-bbb.js', 'assets/config-ccc.js']),
    );
    expect(sizeProblems(dir)).toEqual([]);
  });

  it('does not follow dynamic imports made by the App chunk: those are the lazy chunks', () => {
    const dir = dist({
      'index-aaa.js': ENTRY,
      'App-bbb.js': 'const q = () => import("./QrCode-ddd.js");',
      'config-ccc.js': '',
      'QrCode-ddd.js': 'url too long for the QR renderer',
    });
    expect([...initialGraph(dir, HTML).keys()]).not.toContain('assets/QrCode-ddd.js');
    expect(sizeProblems(dir)).toEqual([]);
  });

  it('fails when a lazy-only chunk (the PayPal SDK) is statically imported inside the App chunk', () => {
    const dir = dist({
      'index-aaa.js': ENTRY,
      'App-bbb.js': 'import{g}from"./paypal-sdk-eee.js";export const a = g;',
      'config-ccc.js': '',
      'paypal-sdk-eee.js': 'export const g = 1;',
    });
    const problems = sizeProblems(dir);
    expect(problems.some((p) => p.includes('PayPal SDK') && p.includes('paypal-sdk-eee.js'))).toBe(
      true,
    );
  });

  it('fails when an AG Grid chunk or marker is in the App graph', () => {
    const dir = dist({
      'index-aaa.js': ENTRY,
      'App-bbb.js': 'import"./ag-grid-fff.js";',
      'config-ccc.js': '',
      'ag-grid-fff.js': 'export const x = 1;',
    });
    expect(sizeProblems(dir).some((p) => p.includes('AG Grid'))).toBe(true);
    const marker = dist({
      'index-aaa.js': ENTRY,
      'App-bbb.js': 'const m = "ag-grid-community";',
      'config-ccc.js': '',
    });
    expect(sizeProblems(marker).some((p) => p.includes('AG Grid'))).toBe(true);
  });
});
