import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildReport,
  cardCandidates,
  luhn,
  main,
  parseArgs,
  readCanaries,
  scanText,
} from '../scan-logs.mjs';

const CANARY = 'CANARY-ADMIN-0123456789abcdefABCDEF';
const canaries = [{ name: 'ADMIN', value: CANARY }];

describe('luhn and card shapes', () => {
  it('accepts a valid test number and rejects a broken one', () => {
    assert.equal(luhn('4111111111111111'), true);
    assert.equal(luhn('4111111111111112'), false);
  });
  it('finds a spaced card number but not an epoch time in milliseconds', () => {
    assert.deepEqual(cardCandidates('card 4111 1111 1111 1111 ok'), ['4111111111111111']);
    assert.deepEqual(cardCandidates('{"ts":1793750400000,"level":"info"}'), []);
  });
  it('ignores digit runs glued to letters and repeated digits', () => {
    assert.deepEqual(cardCandidates('id abc4111111111111111'), []);
    assert.deepEqual(cardCandidates('0000000000000000'), []);
  });
});

describe('scanText', () => {
  it('flags a canary raw and JSON escaped, without echoing the value', () => {
    const r = scanText(`ok\nleak ${CANARY} here\n`, canaries);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].rule, 'canary');
    assert.equal(r.findings[0].line, 2);
    assert.equal(r.findings[0].name, 'ADMIN');
    assert.doesNotMatch(JSON.stringify(r), new RegExp(CANARY));
    const tricky = [{ name: 'Q', value: 'quote"inside-0123456789abc' }];
    assert.equal(scanText('{"k":"quote\\"inside-0123456789abc"}', tricky).findings.length, 1);
  });
  it('flags bearer, jwt, authorization, email and card shapes', () => {
    const line = [
      'Authorization: Bearer abcdefghijklmnop',
      `jwt ${['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcdEFGH'].join('.')}`,
      'mail someone@example.com',
      'pan 4111111111111111',
    ].join('\n');
    const rules = new Set(scanText(line, []).findings.map((f) => f.rule));
    for (const rule of [
      'bearer-token',
      'jwt-shape',
      'authorization-header',
      'email-address',
      'card-number-shape',
    ]) {
      assert.ok(rules.has(rule), rule);
    }
  });
  it('passes a clean redacted log line', () => {
    const line = JSON.stringify({
      ts: 1793750400000,
      level: 'info',
      msg: 'bid accepted Bearer [redacted]',
      context: { authorization: '[redacted]', amount: 6000, auction: 'auc_1' },
    });
    assert.deepEqual(scanText(line, canaries).findings, []);
  });
  it('ignores a canary shorter than the minimum', () => {
    assert.deepEqual(scanText('short', [{ name: 'S', value: 'short' }]).findings, []);
  });
  it('store mode checks canaries only', () => {
    const r = scanText(`someone@example.com ${CANARY}`, canaries, { patterns: false });
    assert.deepEqual(
      r.findings.map((f) => f.rule),
      ['canary'],
    );
  });
});

describe('readCanaries and buildReport', () => {
  it('reports unset or short canaries by name', () => {
    const { canaries: got, missing } = readCanaries(['A', 'B', 'C'], { A: CANARY, B: 'x' });
    assert.deepEqual(
      got.map((c) => c.name),
      ['A'],
    );
    assert.deepEqual(missing, ['B', 'C']);
  });
  it('fails on an empty log, on a missing canary and on a finding', () => {
    const base = { canaries, missingCanaries: [], minLines: 2 };
    const empty = buildReport({ ...base, inputs: [{ path: 'a', kind: 'log', text: '' }] });
    assert.equal(empty.verdict, 'FAIL');
    const missing = buildReport({
      ...base,
      missingCanaries: ['X'],
      inputs: [{ path: 'a', kind: 'log', text: 'one\ntwo\n' }],
    });
    assert.equal(missing.verdict, 'FAIL');
    const leak = buildReport({
      ...base,
      inputs: [{ path: 'a', kind: 'log', text: `one\n${CANARY}\n` }],
    });
    assert.equal(leak.verdict, 'FAIL');
    assert.deepEqual(leak.countsByRule, { canary: 1 });
  });
  it('passes a clean log with enough lines and writes no secret into the report', () => {
    const r = buildReport({
      canaries,
      missingCanaries: [],
      minLines: 2,
      inputs: [
        { path: 'a', kind: 'log', text: 'one\ntwo\n' },
        { path: 'store/x', kind: 'store', text: 'data' },
      ],
    });
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.logLines, 2);
    assert.doesNotMatch(JSON.stringify(r), new RegExp(CANARY));
  });
});

describe('cli', () => {
  it('rejects bad usage', () => {
    assert.throws(() => parseArgs([]), /--log/);
    assert.throws(() => parseArgs(['--log', 'a']), /--canary/);
    assert.throws(
      () => parseArgs(['--log', 'a', '--canary', 'X', '--min-lines', 'q']),
      /whole number/,
    );
  });
  it('exits 0 on a clean log and 1 when a canary leaks (negative control)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-logs-'));
    try {
      const clean = join(dir, 'clean.log');
      const leaky = join(dir, 'leaky.log');
      writeFileSync(clean, '{"msg":"listening"}\n{"msg":"bid"}\n');
      writeFileSync(leaky, `{"msg":"listening"}\n{"msg":"${CANARY}"}\n`);
      const env = { CANARY_ADMIN_KEY: CANARY };
      const out = join(dir, 'report.json');
      const args = (log) => [
        '--log',
        log,
        '--canary',
        'CANARY_ADMIN_KEY',
        '--min-lines',
        '2',
        '--out',
        out,
      ];
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = () => true;
      try {
        assert.equal(main(args(clean), env), 0);
        assert.equal(main(args(leaky), env), 1);
      } finally {
        process.stdout.write = write;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
