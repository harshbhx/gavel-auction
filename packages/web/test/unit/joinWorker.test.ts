import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// FIX-57 (#2159): mangled and traversal join links reached the asset layer, which answered with a
// bare 400. The Worker in infra/web sends every /join/* request to the app's entry page instead.

interface JoinWorker {
  readonly fetch: (request: Request, env: { ASSETS: { fetch: typeof fetch } }) => Promise<Response>;
}

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../infra/web/worker.mjs');
const worker = (await import(pathToFileURL(file).href)) as { default: JoinWorker };

describe('join link Worker', () => {
  it.each(['/join/%E0%A4%A', '/join/..%2F..%2Fetc%2Fpasswd', '/join/ABC123', '/join/'])(
    'serves the entry page for %s',
    async (path) => {
      const assets = vi.fn((r: Request) => Promise.resolve(new Response(`entry ${r.url}`)));
      const res = await worker.default.fetch(new Request(`https://x.test${path}`), {
        ASSETS: { fetch: assets as unknown as typeof fetch },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('entry https://x.test/');
    },
  );

  // FIX-84 (#2227): an unknown /assets/ file used to get index.html with the immutable header.
  describe('unknown files under /assets/', () => {
    const html = (): Response =>
      new Response('<!doctype html>', {
        headers: {
          'content-type': 'text/html',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    const run = (path: string, assets: () => Response, method = 'GET') =>
      worker.default.fetch(new Request(`https://x.test${path}`, { method }), {
        ASSETS: { fetch: (() => Promise.resolve(assets())) as unknown as typeof fetch },
      });

    it('answers 404 with no-store instead of the SPA fallback', async () => {
      const res = await run('/assets/QrCode-deadbeef.js', html);
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-type')).not.toContain('html');
      expect(await res.text()).toBe('Not Found');
    });

    it('answers HEAD with 404 and no body', async () => {
      const res = await run('/assets/nope.js', html, 'HEAD');
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
    });

    it('passes a real hashed file through with its own headers', async () => {
      const real = (): Response =>
        new Response('export{}', {
          headers: {
            'content-type': 'text/javascript',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        });
      const res = await run('/assets/index-BeQU48pZ.js', real);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('immutable');
      expect(await res.text()).toBe('export{}');
    });

    it('keeps a 404 from the asset layer as it is', async () => {
      const res = await run('/assets/x.js', () => new Response('nope', { status: 404 }));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('nope');
    });
  });

  it('wires the Worker and the join route in wrangler.toml', async () => {
    const { readFileSync } = await import('node:fs');
    const toml = readFileSync(resolve(dirname(file), 'wrangler.toml'), 'utf8');
    expect(toml).toContain('main = "worker.mjs"');
    expect(toml).toContain('run_worker_first = ["/*"]');
    expect(toml).toContain('binding = "ASSETS"');
  });
});

// FIX-93: unknown pages answer 404 with the app's entry page; known routes and room routes stay 200.
describe('unknown pages', () => {
  const run = (path: string, spa = true) =>
    worker.default.fetch(new Request(`https://x.test${path}`), {
      ASSETS: {
        fetch: (() =>
          Promise.resolve(
            new Response(spa ? '<!doctype html>app' : 'real', {
              headers: { 'content-type': spa ? 'text/html' : 'image/svg+xml' },
            }),
          )) as unknown as typeof fetch,
      },
    });

  it.each(['/this-does-not-exist', '/try/extra', '/r/room1/nope', '/r/%E0%A4%A/hub', '/join'])(
    'answers 404 with the entry page for %s',
    async (path) => {
      const res = await run(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toBe('<!doctype html>app');
    },
  );

  it.each([
    '/',
    '/about',
    '/try',
    '/try/',
    '/demo/scripted/bid',
    '/r/nope/hub',
    '/r/nope/bid',
    '/r/nope/receipt',
    '/r/nope/console',
    '/r/nope/screen',
    '/r/nope/register',
    '/replay/abc',
  ])('keeps %s at 200 so the app checks the room itself', async (path) => {
    expect((await run(path)).status).toBe(200);
  });

  // Issue 310: the quality report is a real page built into dist/quality, not an app route.
  it.each(['/quality', '/quality/', '/quality/index.html'])(
    'serves the quality report at %s with status 200',
    async (path) => {
      expect((await run(path)).status).toBe(200);
    },
  );

  it('still answers 404 for other unknown pages under /quality', async () => {
    expect((await run('/quality/nope')).status).toBe(404);
  });

  it('passes real static files through', async () => {
    const res = await run('/favicon.svg', false);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('real');
  });

  it('knows exactly the routes of the app (add a route here when you add it to routes.tsx)', async () => {
    const { ROUTES } = await import('../../src/routes');
    const fromApp = ROUTES.filter((r) => r.path !== '*' && r.devOnly !== true).map((r) => r.path);
    const mod = (await import(pathToFileURL(file).href)) as { KNOWN_ROUTES: string[] };
    expect([...mod.KNOWN_ROUTES].filter((p) => p !== '/index.html').sort()).toEqual(
      [...fromApp].sort(),
    );
  });
});

// FIX-131 (#2078): /.well-known/security.txt is a real file and must pass through as text.
describe('security.txt', () => {
  it('passes the static file through and keeps it out of the SPA fallback', async () => {
    const body = 'Contact: https://example.test\n';
    const res = await worker.default.fetch(new Request('https://x.test/.well-known/security.txt'), {
      ASSETS: {
        fetch: (() =>
          Promise.resolve(
            new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
          )) as unknown as typeof fetch,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe(body);
  });

  it('answers 404, not HTML, when the file is missing', async () => {
    const res = await worker.default.fetch(new Request('https://x.test/.well-known/security.txt'), {
      ASSETS: {
        fetch: (() =>
          Promise.resolve(
            new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
          )) as unknown as typeof fetch,
      },
    });
    expect(res.status).toBe(404);
  });
});
