import type { IncomingMessage, ServerResponse } from 'node:http';

/** R-QA-045: the warmup route must finish within this budget. */
export const WARMUP_BUDGET_MS = 3000;

export interface WarmupStep {
  /** Short label, for example `paypal-token`, `database` or `demo-auction`. */
  name: string;
  run(): Promise<void>;
}

export interface WarmupDeps {
  steps: readonly WarmupStep[];
  /** Monotonic-enough millisecond clock; injected for tests. */
  now?: () => number;
  budgetMs?: number;
}

export interface WarmupStepResult {
  name: string;
  ok: boolean;
  ms: number;
}

export interface WarmupReport {
  ok: boolean;
  elapsedMs: number;
  steps: WarmupStepResult[];
}

/** Runs every step in parallel; a step that fails or outlives the budget marks the report not ok. */
export async function runWarmup(deps: WarmupDeps): Promise<WarmupReport> {
  const now = deps.now ?? Date.now;
  const budget = deps.budgetMs ?? WARMUP_BUDGET_MS;
  const start = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), budget);
  });
  const results: WarmupStepResult[] = deps.steps.map((s) => ({ name: s.name, ok: false, ms: 0 }));
  const work = Promise.all(
    deps.steps.map(async (step, i) => {
      const t0 = now();
      const slot = results[i];
      try {
        await step.run();
        if (slot !== undefined) slot.ok = true;
      } catch {
        if (slot !== undefined) slot.ok = false;
      }
      if (slot !== undefined) slot.ms = now() - t0;
    }),
  );
  const winner = await Promise.race([work.then(() => 'done' as const), timeout]);
  if (timer !== undefined) clearTimeout(timer);
  const elapsedMs = now() - start;
  const ok = winner === 'done' && results.every((r) => r.ok) && elapsedMs <= budget;
  return { ok, elapsedMs, steps: results.map((r) => ({ ...r })) };
}

/** `GET /warmup`: pre-initializes the listed dependencies; 200 when all are warm, 503 otherwise. */
export function createWarmupRoute(
  deps: WarmupDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end('{"error":"method_not_allowed"}');
      return;
    }
    const report = await runWarmup(deps);
    res.statusCode = report.ok ? 200 : 503;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(report));
  };
}
