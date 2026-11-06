import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakePayPalServer } from '../src/fake/server.js';
import { clearRegisteredSecrets, logPayment, registerSecret, setLogSink } from '../src/log.js';
import { TokenManager } from '../src/oauth.js';
import { Transport } from '../src/transport.js';

/**
 * Security checks (R-PAY-007, R-PAY-153):
 *  1. no token-shaped string in fixtures, evidence, docs or production sources;
 *  2. nothing secret reaches the log sink on a real client flow;
 *  3. zero runtime dependencies except zod, and no production import of anything
 *     else than zod and Node built-ins. The one exception is a type-only import of
 *     the shared hold contract (`@gavel/shared`), which is erased before run time.
 *
 * Test sources are not scanned for tokens on purpose: the redaction tests plant
 * fake tokens there to prove they are removed.
 */

const PKG = fileURLToPath(new URL('../', import.meta.url));
const REPO = join(PKG, '..', '..');

const PLACEHOLDER = /REDACTED|fake|example|placeholder|dummy|sample|xxxx|\*{3,}|<[^>]*>|\$\{/i;

interface Rule {
  label: string;
  pattern: RegExp;
  /** Group holding the secret-looking value; the whole match when omitted. */
  group?: number;
}

const RULES: readonly Rule[] = [
  { label: 'paypal access token', pattern: /\bA21AA[A-Za-z0-9_-]{20,}/g },
  { label: 'bearer credential', pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/g, group: 1 },
  { label: 'basic credential', pattern: /\bBasic\s+([A-Za-z0-9+/]{16,}={0,2})/g, group: 1 },
  { label: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    label: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    label: 'secret field',
    pattern:
      /["']?(?:client_secret|secret|access_token|password|transmission_sig(?:nature)?)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
    group: 1,
  },
];

/** Labels of every token-shaped string in `text`; values that look like placeholders are fine. */
export function findTokenShapes(text: string): string[] {
  const found: string[] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      const value = m[rule.group ?? 0] ?? m[0];
      if (!PLACEHOLDER.test(value)) found.push(rule.label);
    }
  }
  return found;
}

function walk(dir: string, keep: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage')
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

/** Value planted in the detector samples; assembled at run time so no literal looks like a secret. */
const PLANTED = ['Q1w2', 'E3r4', 'T5y6', 'U7i8'].join('');

const isCode = (f: string): boolean => /\.(ts|tsx|js|mjs|cjs)$/.test(f);

/** `import type { ... } from 'x'` and `export type { ... } from 'x'`, possibly over several lines. */
const TYPE_ONLY = /^\s*(?:import|export)\s+type\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"];?/gm;

describe('token shapes in committed files', () => {
  it('the detector recognizes every planted shape', () => {
    const planted = [
      'token A21AAKabcdefghijklmnopqrstuvwxyz0123456789',
      'Authorization: Bearer Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5',
      'Authorization: Basic dXNlcjpwYXNzd29yZHVzZXJwYXNz',
      '-----BEGIN RSA PRIVATE KEY-----',
      'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlYnl0ZXM',
      `{"client_secret":"${PLANTED}"}`,
      `password = "${PLANTED}"`,
      `"transmission_sig": "${PLANTED}"`,
    ];
    for (const text of planted) expect(findTokenShapes(text), text).not.toEqual([]);
  });

  it('the detector accepts redacted values, short words and placeholders', () => {
    const clean = [
      'Authorization: Bearer [REDACTED]',
      'Authorization: Basic [REDACTED]',
      'Bearer token',
      'Basic ${this.basic}',
      '{"client_secret":"fake-secret-value"}',
      '{"access_token":"fake-token-1"}',
      'secret = "<set in the environment>"',
      'A21AA is the prefix of a token',
    ];
    for (const text of clean) expect(findTokenShapes(text), text).toEqual([]);
  });

  it('no fixture, evidence file, doc or production source holds a token-shaped string', () => {
    const files = [
      // Data, docs and fixtures of the package.
      ...walk(PKG, (f) => !isCode(f) && !f.endsWith('.lock')),
      // Production sources.
      ...walk(join(PKG, 'src'), isCode),
      // Evidence and gate logs kept at the repo level.
      ...walk(join(REPO, 'docs', 'evidence'), () => true),
      ...(existsSync(join(REPO, 'docs', 'GATES.md')) ? [join(REPO, 'docs', 'GATES.md')] : []),
    ];
    expect(files.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const file of new Set(files)) {
      const found = findTokenShapes(readFileSync(file, 'utf8'));
      if (found.length > 0)
        offenders.push(`${relative(REPO, file)}: ${[...new Set(found)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('log output', () => {
  let restore: ReturnType<typeof setLogSink>;
  beforeEach(() => {
    restore = setLogSink(() => undefined);
  });
  afterEach(() => {
    clearRegisteredSecrets();
    setLogSink(restore);
  });

  it('a client flow against the fake never writes a credential to the log', async () => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    const clientId = 'fake-client-id';
    const clientSecret = 'fake-shared-secret-9f3a';
    const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
    const server = new FakePayPalServer({
      clientId,
      clientSecret,
      timers: { sleep: async () => undefined },
    });
    await server.start();
    try {
      const transport = new Transport({ sleep: async () => undefined });
      const auth = new TokenManager({ transport, baseUrl: server.url, clientId, clientSecret });
      const token = await auth.getToken();
      await auth.send({ method: 'GET', path: '/v2/checkout/orders/NO-SUCH', op: 'get' });
      server.faults.add({ kind: 'http_500', op: 'get', times: 2 });
      await auth.send({ method: 'GET', path: '/v2/checkout/orders/NO-SUCH', op: 'get' });
      const text = lines.join('\n');
      expect(lines.length).toBeGreaterThan(0);
      for (const secret of [clientSecret, basic, token]) expect(text).not.toContain(secret);
    } finally {
      await server.stop();
    }
  });

  it('registered secrets and credential-shaped fields are redacted in events and errors', () => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    registerSecret('sk-live-not-a-real-value');
    logPayment({
      op: 'probe',
      message: 'used sk-live-not-a-real-value with Bearer Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5',
      error: new Error('Authorization: Basic dXNlcjpwYXNzd29yZHVzZXJwYXNz'),
    });
    const text = lines.join('\n');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('sk-live-not-a-real-value');
    expect(findTokenShapes(text)).toEqual([]);
  });
});

describe('dependency policy', () => {
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  it('has zod as its only runtime dependency, pinned to an exact version', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['zod']);
    expect(pkg.dependencies?.['zod']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps the check:deps script', () => {
    expect(pkg.scripts?.['check:deps']).toContain('zod');
  });

  it('production sources import only relative modules, node: built-ins and zod', () => {
    const offenders: string[] = [];
    for (const file of walk(join(PKG, 'src'), isCode)) {
      // Type-only statements are erased before run time; the next test checks them.
      const text = readFileSync(file, 'utf8').replace(TYPE_ONLY, '');
      for (const m of text.matchAll(
        /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g,
      )) {
        const spec = m[1] ?? '';
        const ok = spec.startsWith('.') || spec.startsWith('node:') || spec === 'zod';
        if (!ok) offenders.push(`${relative(PKG, file)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('type-only imports name nothing but local, built-in, zod and shared contract types', () => {
    const offenders: string[] = [];
    let shared = 0;
    for (const file of walk(join(PKG, 'src'), isCode)) {
      for (const m of readFileSync(file, 'utf8').matchAll(TYPE_ONLY)) {
        const spec = m[1] ?? '';
        if (spec === '@gavel/shared') shared += 1;
        else if (!spec.startsWith('.') && !spec.startsWith('node:') && spec !== 'zod') {
          offenders.push(`${relative(PKG, file)}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The contract module re-exports the shared hold contract (issue 896).
    expect(shared).toBeGreaterThan(0);
  });

  it('strips only type-only statements', () => {
    const text = [
      "import type { A } from '@gavel/shared';",
      "export type {\n  B,\n  C,\n} from '@gavel/shared';",
      "import { type D, e } from 'left';",
    ].join('\n');
    expect(text.replace(TYPE_ONLY, '')).not.toContain('@gavel/shared');
    expect(text.replace(TYPE_ONLY, '')).toContain("'left'");
  });
});
