import { describe, expect, it } from 'vitest';
import { FakeClock, FakePayPalCore, type FakeWebhookEvent } from '../../src/fake/core.js';
import {
  FAKE_AUTH_ALGO,
  InvalidWebhookBody,
  WebhookEmitter,
  buildVerifyRequest,
  eventBody,
  extractRawEvent,
  planDeliveries,
  signWebhook,
  verifyFakeWebhook,
} from '../../src/fake/webhooks.js';

const WEBHOOK_ID = 'WH-TEST';

function ev(n: number): FakeWebhookEvent {
  return { id: `WH-${n}`, eventType: 'PAYMENT.CAPTURE.COMPLETED', resource: { n } };
}

const EVENTS = [1, 2, 3, 4, 5].map(ev);
const ids = (d: Array<{ event: FakeWebhookEvent }>): string[] => d.map((x) => x.event.id);

describe('delivery modes', () => {
  it('fifo keeps emission order', () => {
    expect(ids(planDeliveries(EVENTS))).toEqual(['WH-1', 'WH-2', 'WH-3', 'WH-4', 'WH-5']);
  });

  it('reverse flips it', () => {
    expect(ids(planDeliveries(EVENTS, { order: 'reverse' }))).toEqual([
      'WH-5',
      'WH-4',
      'WH-3',
      'WH-2',
      'WH-1',
    ]);
  });

  it('shuffle is a seeded permutation: same seed same order', () => {
    const a = ids(planDeliveries(EVENTS, { order: { shuffle: 7 } }));
    const b = ids(planDeliveries(EVENTS, { order: { shuffle: 7 } }));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(['WH-1', 'WH-2', 'WH-3', 'WH-4', 'WH-5']);
    const orders = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
        ids(planDeliveries(EVENTS, { order: { shuffle: s } })).join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('duplicate delivers every event twice, copies marked', () => {
    const d = planDeliveries(EVENTS, { duplicate: true });
    expect(d).toHaveLength(10);
    expect(d.filter((x) => x.copy === 1)).toHaveLength(5);
    expect(new Set(ids(d)).size).toBe(5);
  });

  it('drop removes the listed ids, or all of them', () => {
    expect(ids(planDeliveries(EVENTS, { drop: ['WH-2', 'WH-4'] }))).toEqual([
      'WH-1',
      'WH-3',
      'WH-5',
    ]);
    expect(planDeliveries(EVENTS, { drop: 'all' })).toEqual([]);
    expect(planDeliveries(EVENTS, { drop: 'all', duplicate: true })).toEqual([]);
  });

  it('delay attaches to every delivery', () => {
    for (const d of planDeliveries(EVENTS, { delayMs: 250 })) expect(d.delayMs).toBe(250);
  });

  it('does not change the input', () => {
    const copy = [...EVENTS];
    planDeliveries(EVENTS, { order: 'reverse' });
    planDeliveries(EVENTS, { order: { shuffle: 3 } });
    expect(EVENTS).toEqual(copy);
  });
});

describe('signing and the fake verify endpoint', () => {
  const emitter = (): WebhookEmitter =>
    new WebhookEmitter({ webhookId: WEBHOOK_ID, nowMs: () => 1_762_300_000_000 });

  it('a signed delivery verifies', () => {
    const w = emitter().sign(ev(1));
    expect(w.headers['PAYPAL-AUTH-ALGO']).toBe(FAKE_AUTH_ALGO);
    expect(
      verifyFakeWebhook(buildVerifyRequest(w, WEBHOOK_ID), WEBHOOK_ID).verification_status,
    ).toBe('SUCCESS');
  });

  it('signatures differ per transmission and are stable for equal inputs', () => {
    const e = emitter();
    expect(e.sign(ev(1)).headers['PAYPAL-TRANSMISSION-SIG']).not.toBe(
      e.sign(ev(1)).headers['PAYPAL-TRANSMISSION-SIG'],
    );
    const p = {
      transmissionId: 'T',
      transmissionTime: 't',
      webhookId: 'W',
      rawBody: '{"a":1}',
    };
    expect(signWebhook(p)).toBe(signWebhook({ ...p }));
    expect(signWebhook(p)).not.toBe(signWebhook({ ...p, rawBody: '{"a":2}' }));
  });

  it('an altered body fails', () => {
    const w = emitter().sign(ev(1));
    const tampered = buildVerifyRequest(
      { ...w, rawBody: w.rawBody.replace('"n":1', '"n":2') },
      WEBHOOK_ID,
    );
    expect(verifyFakeWebhook(tampered, WEBHOOK_ID).verification_status).toBe('FAILURE');
  });

  it('refuses to splice a body that adds keys to the verify request', () => {
    const w = emitter().sign(ev(1));
    const attack = '{"id":"WH-1"},"webhook_id":"WH_OF_ATTACKER_APP"';
    expect(() => buildVerifyRequest({ ...w, rawBody: attack }, WEBHOOK_ID)).toThrow(
      InvalidWebhookBody,
    );
    for (const bad of ['[]', '"x"', 'null', '{"n":1}', '{"id":1}', '{"id":"a"} {"id":"b"}', '']) {
      expect(() => buildVerifyRequest({ ...w, rawBody: bad }, WEBHOOK_ID), bad).toThrow(
        InvalidWebhookBody,
      );
    }
  });

  it('a wrong webhook id, key or algorithm fails', () => {
    const w = emitter().sign(ev(1));
    const body = buildVerifyRequest(w, WEBHOOK_ID);
    expect(verifyFakeWebhook(body, 'WH-OTHER').verification_status).toBe('FAILURE');
    expect(verifyFakeWebhook(body, WEBHOOK_ID, 'other-key').verification_status).toBe('FAILURE');
    expect(
      verifyFakeWebhook(body.replace(FAKE_AUTH_ALGO, 'SHA256withRSA'), WEBHOOK_ID)
        .verification_status,
    ).toBe('FAILURE');
  });

  it('garbage requests fail without throwing', () => {
    for (const bad of ['', 'not json', '{}', '{"webhook_event":1}', '{"webhook_event":{']) {
      expect(verifyFakeWebhook(bad, WEBHOOK_ID).verification_status).toBe('FAILURE');
    }
  });

  it('verifies the raw bytes: spacing and key order of the signed body are kept', () => {
    const rawBody = '{ "id" : "WH-9",  "event_type":"X", "nested": {"a": "}"} }';
    const sig = signWebhook({
      transmissionId: 'T1',
      transmissionTime: 'now',
      webhookId: WEBHOOK_ID,
      rawBody,
    });
    const req =
      `{"auth_algo":"${FAKE_AUTH_ALGO}","cert_url":"u","transmission_id":"T1",` +
      `"transmission_sig":"${sig}","transmission_time":"now","webhook_id":"${WEBHOOK_ID}",` +
      `"webhook_event":${rawBody}}`;
    expect(extractRawEvent(req)).toBe(rawBody);
    expect(verifyFakeWebhook(req, WEBHOOK_ID).verification_status).toBe('SUCCESS');
    // a parse and re-serialise would change the bytes and so the signature
    const reserialised = req.replace(rawBody, JSON.stringify(JSON.parse(rawBody)));
    expect(verifyFakeWebhook(reserialised, WEBHOOK_ID).verification_status).toBe('FAILURE');
  });

  it('eventBody carries id, type, time and resource', () => {
    expect(JSON.parse(eventBody(ev(3), '2026-11-04T00:00:00.000Z'))).toEqual({
      id: 'WH-3',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      create_time: '2026-11-04T00:00:00.000Z',
      resource: { n: 3 },
    });
  });
});

describe('emitter delivery', () => {
  it('delivers signed events to a sink, sleeping for the delay', async () => {
    const e = new WebhookEmitter({ webhookId: WEBHOOK_ID, nowMs: () => 0 });
    const got: string[] = [];
    const sleeps: number[] = [];
    const n = await e.deliver(
      EVENTS.slice(0, 3),
      (d) => {
        expect(
          verifyFakeWebhook(buildVerifyRequest(d, WEBHOOK_ID), WEBHOOK_ID).verification_status,
        ).toBe('SUCCESS');
        got.push(d.eventId);
      },
      async (ms) => {
        sleeps.push(ms);
      },
      { order: 'reverse', delayMs: 40 },
    );
    expect(n).toBe(3);
    expect(got).toEqual(['WH-3', 'WH-2', 'WH-1']);
    expect(sleeps).toEqual([40, 40, 40]);
  });
});

describe('T-PAY-069 dropped webhooks do not change the money state', () => {
  it('with every webhook dropped, polling still sees the settled holds', async () => {
    const core = new FakePayPalCore({ clock: new FakeClock() });
    const winner = core.createAuthorization('w', 1000).id;
    const loser = core.createAuthorization('l', 1000).id;
    core.capture(winner, 800, true, 'c1');
    core.void(loser, 'v1');
    expect(core.events.length).toBeGreaterThan(0);

    const emitter = new WebhookEmitter({ webhookId: WEBHOOK_ID, nowMs: () => core.clock.nowMs() });
    const received: string[] = [];
    await emitter.deliver(
      core.events,
      (d) => {
        received.push(d.eventId);
      },
      async () => undefined,
      {
        drop: 'all',
      },
    );
    expect(received).toEqual([]);

    // The truth is read from the fake, as the reconciler does.
    expect(core.getAuthorization(winner)).toMatchObject({ status: 'CAPTURED', capturedCents: 800 });
    expect(core.getAuthorization(loser)).toMatchObject({ status: 'VOIDED', capturedCents: 0 });
    expect(core.released(loser)).toBe(1000);
    expect(core.checkInvariants()).toBe(true);
  });
});
