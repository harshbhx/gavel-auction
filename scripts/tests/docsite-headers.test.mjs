import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const headers = readFileSync(join(root, 'docsite', 'public', '_headers'), 'utf8');
const csp = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(headers)?.[1] ?? '';
const directive = (name) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));

describe('docsite _headers', () => {
  it('limits connect-src to this origin and the API origin', () => {
    // The Try it panel keeps the judge key in sessionStorage and promises to send it only to the
    // API, so no script on the page may reach any other host.
    assert.equal(directive('connect-src'), "connect-src 'self' https://api.gavel.dualmindlab.tech");
  });
  it('allows no remote image host', () => {
    assert.equal(directive('img-src'), "img-src 'self' data: blob:");
  });
  it('keeps the other lock-downs', () => {
    assert.ok(directive('frame-ancestors')?.includes("'none'"));
    assert.ok(directive('object-src')?.includes("'none'"));
    assert.ok(directive('base-uri')?.includes("'self'"));
  });
});

describe('docsite mermaid and canonical', () => {
  it('renders Mermaid at securityLevel strict', () => {
    const src = readFileSync(join(root, 'docsite', 'components', 'mermaid.tsx'), 'utf8');
    assert.match(src, /securityLevel: 'strict'/);
    assert.doesNotMatch(src, /securityLevel: 'loose'/);
  });
  it('sets a canonical link in the root layout', () => {
    const src = readFileSync(join(root, 'docsite', 'app', 'layout.tsx'), 'utf8');
    assert.match(src, /canonical: '\.\/'/);
  });
});
