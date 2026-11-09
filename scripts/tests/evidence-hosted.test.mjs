import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  buildHostedEvidence,
  checkOrigin,
  hostedVerdictLine,
  probeOnce,
  renderHostedMarkdown,
  summarizeJudgeRuns,
  summarizeJudgeSteps,
  webhookProbe,
} from '../evidence/hosted.mjs';

let server;
let api;
const seen = [];
before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      res.statusCode =
        req.url === '/warmup' || req.url === '/healthz' || req.url === '/webhooks/paypal'
          ? 200
          : 404;
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

describe('checkOrigin', () => {
  it('accepts https origins and loopback http, nothing else', () => {
    assert.equal(checkOrigin('https://api.example.com'), 'https://api.example.com');
    assert.equal(checkOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.throws(() => checkOrigin('http://api.example.com'));
    assert.throws(() => checkOrigin('https://api.example.com/x'));
    assert.throws(() => checkOrigin('nope'));
  });
});

describe('probes against a local server', () => {
  it('times /warmup and /healthz', async () => {
    const s = await probeOnce(api, 'idle-1');
    assert.deepEqual(
      s.map((x) => [x.path, x.status, x.label]),
      [
        ['/warmup', 200, 'idle-1'],
        ['/healthz', 200, 'idle-1'],
      ],
    );
    assert.ok(s.every((x) => x.ms >= 0));
  });

  it('posts an ignored event type n times and counts statuses', async () => {
    seen.length = 0;
    const r = await webhookProbe(api, 5);
    assert.equal(r.n, 5);
    assert.deepEqual(r.statusCounts, { 200: 5 });
    assert.equal(r.samples.length, 5);
    assert.equal(seen.filter((x) => x.method === 'POST' && x.url === '/webhooks/paypal').length, 5);
    assert.equal(JSON.parse(seen[0].body).event_type, 'CHECKOUT.ORDER.APPROVED');
  });

  it('records a refused connection as status 0, not a sample', async () => {
    const r = await webhookProbe('http://127.0.0.1:1', 2);
    assert.deepEqual(r.statusCounts, { 0: 2 });
    assert.equal(r.samples.length, 0);
  });
});

describe('judge run summaries', () => {
  const runs = [
    {
      url: 'u1',
      event: 'schedule',
      conclusion: 'success',
      createdAt: '2026-11-08T21:45:00Z',
      updatedAt: '2026-11-08T21:50:30Z',
    },
    {
      url: 'u2',
      event: 'schedule',
      conclusion: 'failure',
      createdAt: '2026-11-07T21:45:00Z',
      updatedAt: '2026-11-07T21:46:00Z',
    },
  ];
  it('counts success and failure and computes durations', () => {
    const s = summarizeJudgeRuns(runs);
    assert.equal(s.listed, 2);
    assert.equal(s.success, 1);
    assert.equal(s.failure, 1);
    assert.equal(s.runs[0].durationSec, 330);
  });
  it('lists steps with seconds', () => {
    const steps = summarizeJudgeSteps({
      steps: [
        {
          name: 'a',
          conclusion: 'success',
          startedAt: '2026-11-08T00:00:00Z',
          completedAt: '2026-11-08T00:00:12Z',
        },
      ],
    });
    assert.deepEqual(steps, [{ name: 'a', conclusion: 'success', seconds: 12 }]);
    assert.deepEqual(summarizeJudgeSteps(undefined), []);
  });
});

describe('hosted evidence', () => {
  const samples = [
    { label: 'a', path: '/warmup', status: 200, ms: 250 },
    { label: 'a', path: '/healthz', status: 200, ms: 120 },
    { label: 'b', path: '/warmup', status: 200, ms: 400 },
    { label: 'b', path: '/healthz', status: 200, ms: 100 },
  ];
  const webhook = {
    n: 30,
    statusCounts: { 200: 30 },
    samples: Array.from({ length: 30 }, (_, i) => 100 + i),
  };
  const judge = summarizeJudgeRuns([
    {
      url: 'u1',
      event: 'schedule',
      conclusion: 'success',
      createdAt: '2026-11-08T21:45:00Z',
      updatedAt: '2026-11-08T21:50:00Z',
    },
  ]);

  it('records a complete set and judges warmup by its slowest sample', () => {
    const ev = buildHostedEvidence({ samples, webhook, judge, idleMinutes: 16 });
    assert.equal(ev.verdict, 'RECORDED');
    assert.equal(ev.warmupAfterIdle.status, 'MET');
    assert.equal(ev.warmupAfterIdle.warmup.max, 400);
    assert.equal(ev.webhookHandler.status, 'MET');
    const slow = buildHostedEvidence({
      samples: [...samples, { label: 'c', path: '/warmup', status: 200, ms: 3500 }],
      webhook,
      judge,
    });
    assert.equal(slow.warmupAfterIdle.status, 'MISSED');
  });

  it('marks a slow webhook p95 MISSED and a non-200 answer INVALID', () => {
    const slow = buildHostedEvidence({
      samples,
      webhook: { ...webhook, samples: Array.from({ length: 30 }, () => 450) },
      judge,
    });
    assert.equal(slow.webhookHandler.status, 'MISSED');
    const bad = buildHostedEvidence({
      samples,
      webhook: { n: 30, statusCounts: { 200: 29, 503: 1 }, samples: [1, 2] },
      judge,
    });
    assert.equal(bad.webhookHandler.status, 'INVALID');
    assert.equal(bad.verdict, 'INCOMPLETE');
  });

  it('is INCOMPLETE with missing parts or a small webhook sample', () => {
    assert.equal(buildHostedEvidence({ webhook, judge }).verdict, 'INCOMPLETE');
    assert.equal(buildHostedEvidence({ samples, judge }).verdict, 'INCOMPLETE');
    assert.equal(buildHostedEvidence({ samples, webhook }).verdict, 'INCOMPLETE');
    const few = buildHostedEvidence({
      samples,
      webhook: { n: 5, statusCounts: { 200: 5 }, samples: [1, 2, 3, 4, 5] },
      judge,
    });
    assert.ok(few.problems.some((p) => /below 20/.test(p)));
  });

  it('renders markdown and a grep-able verdict line', () => {
    const ev = buildHostedEvidence({ samples, webhook, judge, idleMinutes: 16 });
    assert.match(renderHostedMarkdown(ev), /Warmup after idle \(16 min/);
    assert.match(
      hostedVerdictLine(ev),
      /^HOSTED EVIDENCE VERDICT: RECORDED \(warmup max 400 ms vs 3000: MET, n=2; webhook p95/,
    );
  });
});
