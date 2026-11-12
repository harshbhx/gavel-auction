import type { IncomingMessage, ServerResponse } from 'node:http';

export interface HealthDeps {
  /** Resolves when the store answers; rejects when it does not. */
  pingStore(): Promise<void>;
  /** True once every migration is applied. */
  migrationsApplied(): boolean | Promise<boolean>;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function reply(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** R-RT-134: liveness is always 200; readiness needs applied migrations and a store that pings. */
export function createHealthRoutes(deps: HealthDeps): { healthz: Handler; readyz: Handler } {
  return {
    healthz: (_req, res) => {
      reply(res, 200, '{"status":"ok"}');
      return Promise.resolve();
    },
    readyz: async (_req, res) => {
      try {
        if (!(await deps.migrationsApplied())) {
          reply(res, 503, '{"status":"unavailable","reason":"migrations"}');
          return;
        }
        await deps.pingStore();
        reply(res, 200, '{"status":"ok"}');
      } catch {
        reply(res, 503, '{"status":"unavailable","reason":"store"}');
      }
    },
  };
}

/** Build identifier for `GET /version`: the commit the running build was made from. */
export function resolveSha(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env['GAVEL_SHA'] ?? env['RENDER_GIT_COMMIT'] ?? '';
  return /^[0-9a-f]{7,40}$/.test(raw) ? raw : 'unknown';
}

/** R-QA-042: `GET /version` answers the deployed sha so a deploy or rollback can be verified. */
export function createVersionRoute(sha: string): Handler {
  return (_req, res) => {
    reply(res, 200, JSON.stringify({ sha }));
    return Promise.resolve();
  };
}

export interface RootInfoOptions {
  /** Origin of the web app. Default: the public web app. */
  webOrigin?: string;
  /** Origin of the docs site. Default: the public docs site. */
  docsOrigin?: string;
}

export const DEFAULT_WEB_ORIGIN = 'https://gavel.dualmindlab.tech';
const DEFAULT_DOCS = 'https://docs.gavel.dualmindlab.tech';

/**
 * `GET /` and `HEAD /`: a small signpost for anyone who opens the API host in a browser. Public
 * facts only, no secrets. Any other method on `/` keeps answering 404 (not handled here).
 */
export function createRootRoute(options: RootInfoOptions = {}): Handler {
  const web = (options.webOrigin ?? DEFAULT_WEB_ORIGIN).replace(/\/+$/, '');
  const docs = (options.docsOrigin ?? DEFAULT_DOCS).replace(/\/+$/, '');
  const body = JSON.stringify({
    name: 'GAVEL API',
    note: 'PayPal sandbox only. No real money moves.',
    web: `${web}/try`,
    docs,
    apiReference: `${docs}/api-reference`,
    openapi: `${docs}/openapi.yaml`,
    health: '/healthz',
    version: '/version',
  });
  return (req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-length', String(Buffer.byteLength(body)));
    res.end(req.method === 'HEAD' ? undefined : body);
    return Promise.resolve();
  };
}
