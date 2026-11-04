import type { Labels, PaymentsMetrics } from './ports.js';

export const COUNTER_NAMES = [
  'paypal_calls_total',
  'paypal_retries_total',
  'settlement_transitions_total',
  'webhook_events_total',
  'reconcile_findings_total',
] as const;
export const HISTOGRAM_NAMES = ['paypal_latency_ms'] as const;

/** Upper bounds in ms; the last bucket is +Inf. */
export const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000] as const;

interface Histogram {
  buckets: number[];
  count: number;
  sum: number;
}

function labelKey(labels?: Labels): string {
  if (!labels) return '';
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${labels[k] ?? ''}"`).join(',');
}

function series(name: string, key: string): string {
  return key === '' ? name : `${name}{${key}}`;
}

export interface InMemoryMetrics extends PaymentsMetrics {
  counter(name: string, labels?: Labels): number;
  histogram(name: string, labels?: Labels): { count: number; sum: number } | undefined;
}

/** In-process counters and histograms with a sorted text snapshot. */
export function createMetrics(): InMemoryMetrics {
  const counters = new Map<string, Map<string, number>>();
  const histograms = new Map<string, Map<string, Histogram>>();

  return {
    incr(name, labels, by = 1) {
      const m = counters.get(name) ?? new Map<string, number>();
      const key = labelKey(labels);
      m.set(key, (m.get(key) ?? 0) + by);
      counters.set(name, m);
    },
    observe(name, value, labels) {
      const m = histograms.get(name) ?? new Map<string, Histogram>();
      const key = labelKey(labels);
      const h = m.get(key) ?? {
        buckets: new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0),
        count: 0,
        sum: 0,
      };
      let i = LATENCY_BUCKETS_MS.findIndex((b) => value <= b);
      if (i < 0) i = LATENCY_BUCKETS_MS.length;
      h.buckets[i] = (h.buckets[i] ?? 0) + 1;
      h.count += 1;
      h.sum += value;
      m.set(key, h);
      histograms.set(name, m);
    },
    counter(name, labels) {
      return counters.get(name)?.get(labelKey(labels)) ?? 0;
    },
    histogram(name, labels) {
      const h = histograms.get(name)?.get(labelKey(labels));
      return h ? { count: h.count, sum: h.sum } : undefined;
    },
    snapshot() {
      const lines: string[] = [];
      for (const name of [...counters.keys()].sort()) {
        lines.push(`# TYPE ${name} counter`);
        const m = counters.get(name);
        for (const key of [...(m?.keys() ?? [])].sort()) {
          lines.push(`${series(name, key)} ${m?.get(key) ?? 0}`);
        }
      }
      for (const name of [...histograms.keys()].sort()) {
        lines.push(`# TYPE ${name} histogram`);
        const m = histograms.get(name);
        for (const key of [...(m?.keys() ?? [])].sort()) {
          const h = m?.get(key);
          if (!h) continue;
          let cumulative = 0;
          h.buckets.forEach((n, i) => {
            cumulative += n;
            const le = i < LATENCY_BUCKETS_MS.length ? String(LATENCY_BUCKETS_MS[i]) : '+Inf';
            const k = key === '' ? `le="${le}"` : `${key},le="${le}"`;
            lines.push(`${name}_bucket{${k}} ${cumulative}`);
          });
          lines.push(`${series(`${name}_sum`, key)} ${h.sum}`);
          lines.push(`${series(`${name}_count`, key)} ${h.count}`);
        }
      }
      return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
    },
  };
}
