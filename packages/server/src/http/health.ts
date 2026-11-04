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
