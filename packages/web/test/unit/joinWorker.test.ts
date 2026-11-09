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

  it('wires the Worker and the join route in wrangler.toml', async () => {
    const { readFileSync } = await import('node:fs');
    const toml = readFileSync(resolve(dirname(file), 'wrangler.toml'), 'utf8');
    expect(toml).toContain('main = "worker.mjs"');
    expect(toml).toContain('run_worker_first = ["/join/*"]');
    expect(toml).toContain('binding = "ASSETS"');
  });
});
