// API-01: the OpenAPI document and the host router must list the same routes.
// A route added to the server without a spec entry fails here, and so does a spec path that no
// route serves. The spec is read with a small line scanner (the file keeps a fixed two space
// layout, and the redocly lint job validates the full structure); the routes are read from the
// source of packages/server/src.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER_SRC = join(root, 'packages', 'server', 'src');
const SPEC = join(root, 'openapi', 'gavel.yaml');

/** Routes that exist in the code on purpose and are left out of the spec (see info.description). */
export const NOT_DOCUMENTED = new Map([
  ['POST /webhooks/paypal', 'called by PayPal only, verified by signature'],
  ['POST /api/demo/reset', 'DEMO_MODE only, never in production'],
  ['POST /api/demo/seed', 'DEMO_MODE only, never in production'],
  ['POST /api/demo/rooms', 'DEMO_MODE only, never in production'],
]);

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Turns `/a/:id/b` into `/a/{id}/b`. */
export const toTemplate = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/** Paths and methods of an OpenAPI file with the repository layout: "METHOD /path" strings. */
export function specRoutes(text) {
  const out = new Set();
  let inPaths = false;
  let path = null;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith('paths:');
      path = null;
      continue;
    }
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      path = p[1];
      continue;
    }
    const m = /^ {4}([a-z]+):\s*$/.exec(line);
    if (m && path !== null && METHODS.includes(m[1])) out.add(`${m[1].toUpperCase()} ${path}`);
  }
  return out;
}

/** Routes the code registers: "METHOD /path" (templates in `{id}` form). */
export function codeRoutes(serverSrc) {
  const out = new Set();
  const read = (f) => readFileSync(join(serverSrc, f), 'utf8');
  const httpDir = join(serverSrc, 'http');
  const consts = new Map();
  const httpFiles = readdirSync(httpDir).filter((f) => f.endsWith('.ts'));
  for (const f of httpFiles) {
    const text = read(join('http', f));
    for (const m of text.matchAll(/export const ([A-Z_]+_PATH) = '([^']+)'/g)) {
      consts.set(m[1], m[2]);
    }
  }
  for (const f of httpFiles) {
    const text = read(join('http', f));
    // app.get('/p', ...) and app.post('/p', ...), or the same with a path constant.
    for (const m of text.matchAll(/\bapp\.(get|post)\(\s*(?:'([^']+)'|([A-Z_]+_PATH))/g)) {
      const p = m[2] ?? consts.get(m[3]);
      assert.ok(p, `unknown path constant ${m[3]} in ${f}`);
      out.add(`${m[1].toUpperCase()} ${toTemplate(p)}`);
    }
    // app.route('DELETE', '/p', ...)
    for (const m of text.matchAll(/\bapp\.route\(\s*'([A-Z]+)'\s*,\s*'([^']+)'/g)) {
      out.add(`${m[1]} ${toTemplate(m[2])}`);
    }
  }
  // Demo routes: constants in http/demo.ts, all POST.
  for (const k of ['DEMO_RESET_PATH', 'DEMO_SEED_PATH', 'DEMO_ROOMS_PATH']) {
    const p = readFileSync(join(httpDir, 'demo.ts'), 'utf8').match(
      new RegExp(`export const ${k} = '([^']+)'`),
    );
    assert.ok(p, `${k} not found`);
    out.add(`POST ${p[1]}`);
  }
  // Routes the host dispatches by path in boot/compose.ts. They are GET unless noted below.
  const compose = read('boot/compose.ts');
  for (const m of compose.matchAll(/\bpath === '(\/[^']+)'/g)) out.add(`GET ${m[1]}`);
  const webhook = /export const WEBHOOK_PATH = '([^']+)'/.exec(compose);
  assert.ok(webhook, 'WEBHOOK_PATH not found');
  out.add(`POST ${webhook[1]}`);
  // The two operator settlement routes and the per-auction export.
  const ops = read('http/ops.ts');
  const settle =
    /OPS_SETTLEMENT_PATH = \/\^\\\/ops\\\/auctions\\\/\(\[\^\/\]\+\)\\\/\(([a-z|-]+)\)\$\//.exec(
      ops,
    );
  assert.ok(settle, 'OPS_SETTLEMENT_PATH not found');
  for (const action of settle[1].split('|')) out.add(`POST /ops/auctions/{id}/${action}`);
  assert.match(
    read('http/export.ts'),
    /EXPORT_PATH = \/\^\\\/api\\\/auctions\\\/\(\[\^\/\]\+\)\\\/export/,
  );
  out.add('GET /api/auctions/{id}/export');
  return out;
}

/** Every `$ref: '#/components/...'` must point at something that exists. */
export function brokenRefs(text) {
  const names = new Set();
  let section = null;
  for (const line of text.split('\n')) {
    const s = /^ {2}([A-Za-z]+):\s*$/.exec(line);
    if (s) section = s[1];
    const n = /^ {4}([A-Za-z0-9_.-]+):/.exec(line);
    if (n && section !== null) names.add(`#/components/${section}/${n[1]}`);
  }
  const bad = [];
  for (const m of text.matchAll(/\$ref: '(#\/components\/[^']+)'/g)) {
    if (!names.has(m[1])) bad.push(m[1]);
  }
  return bad;
}

describe('openapi spec and server routes', () => {
  const spec = readFileSync(SPEC, 'utf8');
  const documented = specRoutes(spec);
  const code = codeRoutes(SERVER_SRC);

  it('documents every route the server registers', () => {
    const missing = [...code].filter((r) => !documented.has(r) && !NOT_DOCUMENTED.has(r));
    assert.deepEqual(missing, [], 'routes in the code but not in openapi/gavel.yaml');
  });

  it('has no path the server does not serve', () => {
    const extra = [...documented].filter((r) => !code.has(r));
    assert.deepEqual(extra, [], 'paths in openapi/gavel.yaml with no route in the code');
  });

  it('does not document the routes it says it leaves out', () => {
    for (const r of NOT_DOCUMENTED.keys()) assert.ok(!documented.has(r), `${r} must stay out`);
  });

  it('only names left-out routes that still exist in the code', () => {
    for (const r of NOT_DOCUMENTED.keys()) assert.ok(code.has(r), `${r} is gone from the code`);
  });

  it('resolves every component reference', () => {
    assert.deepEqual(brokenRefs(spec), []);
  });

  it('lists the public API domain first and no Render host in examples (#2427)', () => {
    const urls = [...spec.matchAll(/^ {2}- url: (\S+)/gm)].map((m) => m[1]);
    assert.equal(urls[0], 'https://api.gavel.dualmindlab.tech');
    assert.doesNotMatch(spec, /wss:\/\/[^\s]*onrender\.com/);
  });

  it('only offers what createAuction accepts (#2420, #2421)', () => {
    assert.doesNotMatch(spec, /enum: \[english, proxy/);
    assert.doesNotMatch(spec, /enum: \[event, lot\]/);
    assert.doesNotMatch(spec, /^ {8}incrementLadder:/m);
    assert.doesNotMatch(
      spec,
      /one of the auction's offered presets|not one of the offered amounts/,
    );
    // No example epoch in the past may sit next to the end-time rule: the example is a placeholder.
    assert.match(spec, /endTs: 1893456000000/);
  });

  it('declares the origin refusal on the write operations that have no role check (#2425)', () => {
    const ops = [
      'createAuction',
      'joinAuction',
      'createHold',
      'approveHold',
      'abandonHold',
      'checkJudgeKey',
      'createJudgeRoom',
      'joinJudgeRoom',
      'pauseJudgeRooms',
      'revokeJudgeKey',
    ];
    for (const id of ops) {
      const at = spec.indexOf(`operationId: ${id}\n`);
      assert.ok(at > 0, id);
      const rest = spec.slice(at);
      const next = rest.search(/\n {2}\/|\n {4}(get|post|delete):/);
      const block = next < 0 ? rest : rest.slice(0, next);
      assert.match(
        block,
        /'403':\n\s+\$ref: '#\/components\/responses\/(OriginForbidden|Forbidden)'/,
        id,
      );
    }
  });

  it('keeps real secrets out of the document', () => {
    assert.doesNotMatch(spec, /api-m\.paypal\.com|(?<![\w.-])www\.paypal\.com/i);
    assert.doesNotMatch(spec, /Bearer [A-Za-z0-9_-]{20,}/);
  });
});

describe('route scanner', () => {
  it('reads paths and methods from the spec layout', () => {
    const text =
      'paths:\n  /a/{id}:\n    get:\n      x: 1\n    delete:\n      x: 1\n  /b:\n    post:\ncomponents:\n  /c:\n    get:\n';
    assert.deepEqual([...specRoutes(text)].sort(), ['DELETE /a/{id}', 'GET /a/{id}', 'POST /b']);
  });

  it('turns route parameters into templates', () => {
    assert.equal(toTemplate('/api/holds/:holdId/approve'), '/api/holds/{holdId}/approve');
  });

  it('flags a reference with no target', () => {
    const text =
      "components:\n  schemas:\n    A:\n      type: object\n  x:\n    $ref: '#/components/schemas/B'\n";
    assert.deepEqual(brokenRefs(text), ['#/components/schemas/B']);
  });
});
