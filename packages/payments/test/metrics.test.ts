import { describe, expect, it } from 'vitest';
import { createMetrics } from '../src/metrics.js';

describe('metrics', () => {
  it('counts per label set', () => {
    const m = createMetrics();
    m.incr('paypal_calls_total', { op: 'capture', outcome: 'definite' });
    m.incr('paypal_calls_total', { outcome: 'definite', op: 'capture' }, 2);
    m.incr('paypal_calls_total', { op: 'void', outcome: 'unknown' });
    expect(m.counter('paypal_calls_total', { op: 'capture', outcome: 'definite' })).toBe(3);
    expect(m.counter('paypal_calls_total', { op: 'void', outcome: 'unknown' })).toBe(1);
    expect(m.counter('paypal_retries_total')).toBe(0);
  });

  it('records histograms', () => {
    const m = createMetrics();
    m.observe('paypal_latency_ms', 40, { op: 'capture' });
    m.observe('paypal_latency_ms', 700, { op: 'capture' });
    m.observe('paypal_latency_ms', 9000, { op: 'capture' });
    expect(m.histogram('paypal_latency_ms', { op: 'capture' })).toEqual({ count: 3, sum: 9740 });
    expect(m.histogram('paypal_latency_ms', { op: 'void' })).toBeUndefined();
  });

  it('renders a sorted, deterministic snapshot', () => {
    const m = createMetrics();
    expect(m.snapshot()).toBe('');
    m.incr('webhook_events_total', { result: 'ok' });
    m.incr('paypal_retries_total', { op: 'capture' });
    m.observe('paypal_latency_ms', 40, { op: 'capture' });
    const s = m.snapshot();
    expect(s.indexOf('paypal_retries_total')).toBeLessThan(s.indexOf('webhook_events_total'));
    expect(s).toContain('paypal_retries_total{op="capture"} 1');
    expect(s).toContain('paypal_latency_ms_bucket{op="capture",le="50"} 1');
    expect(s).toContain('paypal_latency_ms_bucket{op="capture",le="+Inf"} 1');
    expect(s).toContain('paypal_latency_ms_count{op="capture"} 1');
    expect(m.snapshot()).toBe(s);
  });
});
