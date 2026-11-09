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
    expect(toml).toContain('run_worker_first = ["/join/*", "/assets/*"]');
    expect(toml).toContain('binding = "ASSETS"');
  });
});
