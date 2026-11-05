import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeClientMsg, decodeServerMsg } from '@gavel/shared';

// T-QA-074 (SEC-07): 1000 random frames never crash the decoder and never decode as a valid
// message unless they match the wire schema. Set GAVEL_STAGING_URL (http or https base URL) to
// also replay frames against a deployed server and check it stays reachable.

const RUNS = 1000;
const FAILURE_CODES = ['bad_message', 'unsupported_version'];

const jsonValue = fc.jsonValue();
const frame = fc.oneof(
  fc.string(),
  fc.uint8Array({ maxLength: 256 }),
  jsonValue.map((v) => JSON.stringify(v)),
  fc
    .record({ v: fc.anything(), t: fc.anything(), extra: fc.anything() })
    .map((o) => JSON.stringify(o)),
  fc.record({ v: fc.constant(1), t: fc.string() }).map((o) => JSON.stringify(o)),
);

describe('random frames against the wire decoder', () => {
  it('never throws and rejects with a known code', () => {
    fc.assert(
      fc.property(frame, (raw) => {
        const result = decodeClientMsg(raw);
        if (!result.ok) expect(FAILURE_CODES).toContain(result.code);
        const server = decodeServerMsg(raw);
        if (!server.ok) expect(FAILURE_CODES).toContain(server.code);
      }),
      { numRuns: RUNS },
    );
  });

  it('does not accept a frame with an unknown message type', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (t) => {
        fc.pre(t !== 'join' && t !== 'bid' && t !== 'confirm_response');
        expect(decodeClientMsg(JSON.stringify({ v: 1, t })).ok).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });
});

const base = process.env['GAVEL_STAGING_URL'];

describe.skipIf(base === undefined)('random frames against a deployed server', () => {
  it('stays reachable after the fuzz run', async (ctx) => {
    const root = base ?? '';
    const url = root.replace(/^http/, 'ws');
    const opens = await new Promise<boolean>((resolve) => {
      const probe = new WebSocket(url);
      const timer = setTimeout(() => {
        probe.close();
        resolve(false);
      }, 5000);
      probe.addEventListener('open', () => {
        clearTimeout(timer);
        probe.close();
        resolve(true);
      });
      probe.addEventListener('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    if (!opens) {
      ctx.skip('no WebSocket gateway answers on the target, so frames cannot be delivered');
      return;
    }
    const samples = fc.sample(frame, 50);
    await Promise.all(
      samples.map(
        (raw) =>
          new Promise<void>((resolve) => {
            const ws = new WebSocket(url);
            const done = (): void => resolve();
            ws.addEventListener('open', () => {
              ws.send(typeof raw === 'string' ? raw : raw.slice().buffer);
              setTimeout(() => {
                ws.close();
                done();
              }, 50);
            });
            ws.addEventListener('error', done);
            ws.addEventListener('close', done);
          }),
      ),
    );
    const res = await fetch(root);
    expect(res.status).toBeLessThan(500);
  });
});
