import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS, parseConfig } from '../src/config';

const text = readFileSync(fileURLToPath(new URL('../../../render.yaml', import.meta.url)), 'utf8');

/** Reads the `- key:` entries of envVars with their value or sync flag; no yaml parser needed. */
function envVars(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /- key: ([A-Z0-9_]+)\n\s+(value|sync): ([^\n]+)/g;
  for (const m of text.matchAll(re)) out.set(m[1] ?? '', `${m[2]}:${m[3]}`);
  return out;
}

describe('render.yaml blueprint (R8-Q01)', () => {
  it('starts the server through its npm script, not a dist file that is never built', () => {
    expect(text).toMatch(/startCommand: npm start -w @gavel\/server/);
    expect(text).not.toMatch(/dist\/index\.js/);
  });

  it('installs dev packages because the start script runs vite-node', () => {
    expect(text).toMatch(/buildCommand: npm ci --include=dev/);
  });

  it('sets only names the server config reads', () => {
    const known = new Set<string>(CONFIG_KEYS);
    for (const key of envVars().keys()) {
      if (key === 'NODE_VERSION') continue;
      expect(known.has(key), key).toBe(true);
    }
    expect(text).not.toMatch(/GAVEL_DATA_DIR|GAVEL_MODE/);
  });

  it('declares the secrets without a value and boots the config once they are filled', () => {
    const vars = envVars();
    for (const k of [
      'PUBLIC_URL',
      'TOKEN_SECRET',
      'ADMIN_KEY',
      'PAYPAL_CLIENT_ID',
      'PAYPAL_CLIENT_SECRET',
      'PAYPAL_WEBHOOK_ID',
    ]) {
      expect(vars.get(k)).toBe('sync:false');
    }
    const env: Record<string, string> = {};
    for (const [k, v] of vars) if (v.startsWith('value:')) env[k] = v.slice(6).replace(/^'(.*)'$/, '$1');
    const r = parseConfig({
      ...env,
      PUBLIC_URL: 'https://gavel-host.example.com',
      TOKEN_SECRET: 'x'.repeat(40),
      ADMIN_KEY: 'y'.repeat(40),
      PAYPAL_CLIENT_ID: 'c'.repeat(20),
      PAYPAL_CLIENT_SECRET: 's'.repeat(20),
      PAYPAL_WEBHOOK_ID: 'w'.repeat(20),
    });
    expect(r).toMatchObject({ ok: true });
  });
});
