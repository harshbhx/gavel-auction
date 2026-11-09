import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Session } from 'node:inspector/promises';
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';
import type { Rig } from '../../test/flow/rig';

// Memory diagnostics for the load CLI (#2203). Off by default; `--diag <file>` turns it on.
// A sample every few seconds records process.memoryUsage(), v8.getHeapStatistics() and, after a
// forced garbage collection when `node --expose-gc` is in use, the live heap size, so memory that
// is still referenced can be told from garbage that has not been collected yet. Per-component
// counters (map sizes, array lengths) say which store holds the objects. A full v8 heap snapshot
// is too heavy for a shared runner, so the counters stand in for it.

const MB = 1024 * 1024;

export type Counters = Record<string, number>;

/**
 * Counts the collections reachable from `root` as own properties, down to `depth` levels: the size
 * of each Map, Set and array, and for a Map of arrays or maps the total of the inner sizes
 * (`<path>.values`). Cycles are skipped. Keys are dotted property paths below `name`.
 */
export function sizeCounters(root: unknown, name: string, depth = 3): Counters {
  const out: Counters = {};
  const seen = new Set<object>();
  const walk = (value: unknown, path: string, left: number): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      out[path] = value.length;
      return;
    }
    if (value instanceof Map || value instanceof Set) {
      out[path] = value.size;
      if (value instanceof Map) {
        let inner = 0;
        let any = false;
        for (const v of value.values()) {
          if (Array.isArray(v) || v instanceof Map || v instanceof Set) {
            inner += Array.isArray(v) ? v.length : v.size;
            any = true;
          }
        }
        if (any) out[`${path}.values`] = inner;
      }
      return;
    }
    if (left <= 0) return;
    for (const key of Object.keys(value)) {
      walk((value as Record<string, unknown>)[key], `${path}.${key}`, left - 1);
    }
  };
  walk(root, name, depth);
  return out;
}

export interface DiagSample {
  atMs: number;
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  heapSizeLimitMb: number;
  /** Live heap after a forced collection; null when gc is not exposed. */
  liveHeapMb: number | null;
  /** Active resources by kind (Timeout, TCPSocketWrap, ...). */
  resources: Record<string, number>;
  spaces: Record<string, number>;
  counters: Counters;
}

export interface DiagOptions {
  intervalMs?: number;
  now?: () => number;
  /** Component counters, called at each sample. */
  probe: () => Counters;
  /** Forces a collection; defaults to globalThis.gc when exposed. */
  gc?: (() => void) | undefined;
}

function countResources(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of process.getActiveResourcesInfo()) out[r] = (out[r] ?? 0) + 1;
  return out;
}

export function takeSample(opts: DiagOptions, startMs: number): DiagSample {
  const gc = opts.gc ?? (globalThis as { gc?: () => void }).gc;
  let liveHeapMb: number | null = null;
  if (gc !== undefined) {
    gc();
    liveHeapMb = round(process.memoryUsage().heapUsed / MB);
  }
  const mem = process.memoryUsage();
  const heap = getHeapStatistics();
  const spaces: Record<string, number> = {};
  for (const s of getHeapSpaceStatistics()) spaces[s.space_name] = round(s.space_used_size / MB);
  return {
    atMs: Math.round((opts.now ?? Date.now)() - startMs),
    rssMb: round(mem.rss / MB),
    heapUsedMb: round(mem.heapUsed / MB),
    externalMb: round(mem.external / MB),
    arrayBuffersMb: round(mem.arrayBuffers / MB),
    heapSizeLimitMb: round(heap.heap_size_limit / MB),
    liveHeapMb,
    resources: countResources(),
    spaces,
    counters: opts.probe(),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface Diagnostics {
  samples: DiagSample[];
  /** Stops the sampler and returns the summary. */
  finish(): DiagSummary;
}

export interface DiagSummary {
  samples: DiagSample[];
  /** Counter growth from the first to the last sample, largest first. */
  counterGrowth: Array<{ name: string; first: number; last: number; delta: number }>;
  rssGrowthMb: number;
  liveHeapGrowthMb: number | null;
  /** Live bytes by allocating function at the end of the run, when sampled. */
  retained?: RetainedSite[];
}

/** Summarises samples: what grew between the first and the last one. */
export function summarize(samples: readonly DiagSample[]): DiagSummary {
  const first = samples[0];
  const last = samples.at(-1);
  const names = new Set<string>();
  for (const s of samples) for (const k of Object.keys(s.counters)) names.add(k);
  const counterGrowth = [...names]
    .map((name) => {
      const a = first?.counters[name] ?? 0;
      const b = last?.counters[name] ?? 0;
      return { name, first: a, last: b, delta: b - a };
    })
    .sort((x, y) => y.delta - x.delta);
  const a = first?.liveHeapMb ?? null;
  const b = last?.liveHeapMb ?? null;
  const live = a !== null && b !== null ? round(b - a) : null;
  return {
    samples: [...samples],
    counterGrowth,
    rssGrowthMb: round((last?.rssMb ?? 0) - (first?.rssMb ?? 0)),
    liveHeapGrowthMb: live,
  };
}

/** Starts sampling now and every `intervalMs` (5 s by default). The timer does not keep the process alive. */
export function startDiagnostics(opts: DiagOptions): Diagnostics {
  const now = opts.now ?? Date.now;
  const startMs = now();
  const samples: DiagSample[] = [takeSample(opts, startMs)];
  const timer = setInterval(() => {
    samples.push(takeSample(opts, startMs));
  }, opts.intervalMs ?? 5000);
  timer.unref();
  return {
    samples,
    finish: (): DiagSummary => {
      clearInterval(timer);
      samples.push(takeSample(opts, startMs));
      return summarize(samples);
    },
  };
}

export function writeDiagnostics(file: string, summary: DiagSummary): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
}

/** Sizes of everything the rig keeps: the fake PayPal, the room store, the ledger, the holds. */
export function rigCounters(rig: Rig): Record<string, number> {
  return {
    ...sizeCounters(rig.paypal.core, 'fakePaypal.core'),
    ...sizeCounters(rig.stores.store, 'stores.roomStore'),
    ...sizeCounters(rig.stores.ledger, 'stores.ledger'),
    ...sizeCounters(rig.stores.holds, 'stores.holds'),
    ...sizeCounters(rig.stores.journals, 'stores.journals'),
    ...sizeCounters(rig.stores.webhookEvents, 'stores.webhookEvents'),
    'rig.sleeps': rig.sleeps.length,
  };
}

export interface RetainedSite {
  fn: string;
  url: string;
  line: number;
  selfMb: number;
}

interface ProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: ProfileNode[];
}

/** Adds up the live bytes of a sampling heap profile by allocating function, largest first. */
export function topRetained(head: ProfileNode, limit = 25): RetainedSite[] {
  const sites = new Map<string, RetainedSite>();
  const stack: ProfileNode[] = [head];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === undefined) break;
    if (n.selfSize > 0) {
      const f = n.callFrame;
      const key = `${f.functionName}|${f.url}|${String(f.lineNumber)}`;
      const cur = sites.get(key) ?? {
        fn: f.functionName || '(anonymous)',
        url: f.url,
        line: f.lineNumber + 1,
        selfMb: 0,
      };
      cur.selfMb += n.selfSize / MB;
      sites.set(key, cur);
    }
    for (const c of n.children) stack.push(c);
  }
  return [...sites.values()]
    .map((s) => ({ ...s, selfMb: round(s.selfMb) }))
    .sort((a, b) => b.selfMb - a.selfMb)
    .slice(0, limit);
}

/**
 * Starts the V8 sampling heap profiler (cheap, unlike a heap snapshot). `stop` returns the
 * allocation sites of the objects still alive, which names the code that holds the memory.
 */
export async function startHeapSampling(): Promise<() => Promise<RetainedSite[]>> {
  const session = new Session();
  session.connect();
  await session.post('HeapProfiler.startSampling', {
    samplingInterval: 65536,
    includeObjectsCollectedByMajorGC: false,
    includeObjectsCollectedByMinorGC: false,
  });
  return async (): Promise<RetainedSite[]> => {
    (globalThis as { gc?: () => void }).gc?.();
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();
    return topRetained(profile.head as unknown as ProfileNode);
  };
}
