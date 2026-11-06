// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cspProblems } from '../../scripts/check-size.mjs';
import { CSP_TOKEN, buildCsp, connectSources, renderCsp } from '../../vite.config';

const ENV = {
  VITE_API_BASE: 'https://host.example.test',
  VITE_WS_BASE: 'wss://host.example.test/ws',
};

const INDEX = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

function connectOf(policy: string): string[] {
  const directive = policy.split(';').find((d) => d.trim().startsWith('connect-src')) ?? '';
  return directive.trim().split(/\s+/).slice(1);
}

describe('generated CSP (R-WEB-004)', () => {
  it('index.html carries the placeholder, not a fixed policy', () => {
    expect(INDEX).toContain(CSP_TOKEN);
    expect(INDEX).not.toContain('localhost');
  });

  it('a production build allows the configured API and WS origins', () => {
    const html = renderCsp(INDEX, ENV, false);
    expect(html).not.toContain(CSP_TOKEN);
    const sources = connectOf(html);
    expect(sources).toContain('https://host.example.test');
    expect(sources).toContain('wss://host.example.test');
    expect(sources).toContain("'self'");
  });

  it('does not allow an origin that is not configured', () => {
    const sources = connectOf(renderCsp(INDEX, ENV, false));
    expect(sources).not.toContain('https://other.example.test');
    expect(sources.some((s) => s.includes('*'))).toBe(false);
  });

  it('keeps localhost out of production and in dev', () => {
    expect(connectSources(ENV, false).join(' ')).not.toContain('localhost');
    expect(connectSources(ENV, true)).toContain('http://localhost:8787');
    expect(connectSources(ENV, true)).toContain('ws://localhost:8787');
  });

  it('ignores a value that is not an absolute URL', () => {
    expect(connectSources({ VITE_API_BASE: 'not a url', VITE_WS_BASE: '' }, false)).toEqual([
      "'self'",
      'https://www.sandbox.paypal.com',
      'https://api-m.sandbox.paypal.com',
    ]);
  });

  it('never allows inline or eval script', () => {
    const script = buildCsp(ENV, false)
      .split(';')
      .find((d) => d.trim().startsWith('script-src'));
    expect(script).not.toContain('unsafe-inline');
    expect(script).not.toContain('unsafe-eval');
  });

  it('the size gate accepts the built page and rejects a missing origin', () => {
    const built = renderCsp(INDEX, ENV, false);
    expect(cspProblems(built, ENV)).toEqual([]);
    expect(cspProblems(built, { VITE_API_BASE: 'https://other.example.test' })).toHaveLength(1);
    const wild = built.replace("connect-src 'self'", "connect-src 'self' *");
    expect(cspProblems(wild, ENV)).toHaveLength(1);
  });
});
