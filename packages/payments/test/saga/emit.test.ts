import { describe, expect, it } from 'vitest';
import {
  auditEventFor,
  emittingAudit,
  settlementUpdateFor,
  type SettlementPayload,
  type SettlementUpdate,
} from '../../src/saga/emit.js';
import { runSettlement } from '../../src/saga/void.js';
import { canonicalJson } from '../../src/types.js';
import { CEILINGS, makeRig, planFor, seed, type Rig } from './rig.js';
import { freshJournal } from '../helpers/age.js';

async function runWithFallback(): Promise<{
  rig: Rig;
  payloads: SettlementPayload[];
  json: string[];
}> {
  const rig = makeRig(CEILINGS);
  const payloads: SettlementPayload[] = [];
  const json: string[] = [];
  const audit = emittingAudit({
    journals: rig.journals,
    inner: rig.deps.audit,
    publish: (p, j) => {
      payloads.push(p);
      json.push(j);
    },
  });
  await seed(rig);
  rig.core.inject('capture', 'capture_declined', rig.auth['b1'] ?? '', 1);
  const out = await runSettlement({ ...rig.deps, audit }, 'auc1');
  expect(out.status).toBe('settled');
  return { rig, payloads, json };
}

function updates(payloads: SettlementPayload[]): SettlementUpdate[] {
  return payloads.filter((p): p is SettlementUpdate => p.type === 'settlement_update');
}

describe('T-PAY-049 audit entries and settlement updates', () => {
  it('one update per transition, in order, and one audit event per money call', async () => {
    const { rig, payloads } = await runWithFallback();
    const j = await rig.journals.load('auc1');
    if (j === null) throw new Error('journal');

    expect(updates(payloads).map((u) => u.state)).toEqual(j.history.map((h) => h.to));

    const calls = payloads.filter((p) => p.type === 'audit_event' && p.kind === 'paypal_call');
    const money = rig.core.calls.filter((c) => c.op === 'capture' || c.op === 'void');
    expect(calls).toHaveLength(money.length);
    expect(calls.filter((c) => c.type === 'audit_event' && c.op === 'capture')).toHaveLength(2);
    // The same entries reached the wrapped sink: transitions plus calls.
    expect(rig.audits.filter((a) => a.kind === 'state_change')).toHaveLength(j.history.length);
    expect(rig.audits.filter((a) => a.kind === 'paypal_call')).toHaveLength(money.length);
  });

  it('shows the fallback with from, to and reason, and the final capture', async () => {
    const { payloads } = await runWithFallback();
    const ups = updates(payloads);
    const fb = ups.find((u) => u.state === 'FALLBACK_RUNNER_UP');
    expect(fb).toMatchObject({
      fromBidderId: 'b1',
      toBidderId: 'b2',
      reason: 'declined',
      capture: null,
    });
    expect(fb?.holds).toEqual([
      { bidderId: 'b1', holdId: 'hold-b1', status: 'DENIED' },
      { bidderId: 'b2', holdId: 'hold-b2', status: 'HELD' },
      { bidderId: 'b3', holdId: 'hold-b3', status: 'HELD' },
    ]);
    const last = ups[ups.length - 1];
    expect(last).toMatchObject({
      state: 'SETTLED',
      fromBidderId: null,
      reason: null,
      capture: { bidderId: 'b2', amountCents: 21000 },
    });
    expect(last?.holds.map((h) => h.status)).toEqual(['VOIDED', 'CAPTURED', 'VOIDED']);
  });

  it('publishes canonical JSON that is stable from run to run', async () => {
    const a = await runWithFallback();
    const b = await runWithFallback();
    expect(a.json).toEqual(b.json);
    for (const text of a.json) {
      const parsed: unknown = JSON.parse(text);
      expect(text).toBe(canonicalJson(parsed));
      const keys = Object.keys(parsed as Record<string, unknown>);
      expect(keys).toEqual([...keys].sort());
      expect(text).not.toMatch(/\s/);
    }
  });

  it('writes to the wrapped sink before publishing', async () => {
    const rig = makeRig(CEILINGS);
    const order: string[] = [];
    const audit = emittingAudit({
      journals: rig.journals,
      inner: { append: async () => void order.push('sink') },
      publish: () => void order.push('publish'),
    });
    await audit.append({ kind: 'kill_switch', label: 'engage:x', actor: 'ops', tsMs: 1 });
    expect(order).toEqual(['sink', 'publish']);
  });
});

describe('payload builders', () => {
  it('auditEventFor fills every field, with null for what an entry does not carry', () => {
    expect(
      auditEventFor({
        kind: 'paypal_call',
        auctionId: 'a',
        holdId: 'h',
        op: 'capture',
        requestId: 'gv1-x',
        attempt: 2,
        status: 500,
        outcome: 'unknown',
        debugId: 'd',
        tsMs: 5,
      }),
    ).toEqual({
      type: 'audit_event',
      auctionId: 'a',
      kind: 'paypal_call',
      op: 'capture',
      holdId: 'h',
      requestId: 'gv1-x',
      attempt: 2,
      status: 500,
      outcome: 'unknown',
      debugId: 'd',
      label: null,
      actor: null,
      tsMs: 5,
    });
    expect(auditEventFor({ kind: 'kill_switch', tsMs: 1 })).toMatchObject({
      auctionId: null,
      op: null,
      attempt: null,
    });
  });

  it('settlementUpdateFor shows a hold voided under its hold id as VOIDED', () => {
    const rig = makeRig(CEILINGS);
    const j = freshJournal(planFor(rig, CEILINGS, [['b1', 22000]]));
    j.voids['hold-b2'] = 'voided';
    j.voids['constructor'] = 'voided';
    const holds = settlementUpdateFor(j, 9).holds;
    expect(holds.find((h) => h.bidderId === 'b2')?.status).toBe('VOIDED');
    expect(holds.find((h) => h.bidderId === 'b3')?.status).toBe('HELD');
  });

  it('settlementUpdateFor on a fresh journal has every hold HELD and no capture', () => {
    const rig = makeRig(CEILINGS);
    const j = freshJournal(planFor(rig, CEILINGS, [['b1', 22000]]));
    expect(settlementUpdateFor(j, 9)).toEqual({
      type: 'settlement_update',
      auctionId: 'auc1',
      state: 'HELD',
      holds: [
        { bidderId: 'b1', holdId: 'hold-b1', status: 'HELD' },
        { bidderId: 'b2', holdId: 'hold-b2', status: 'HELD' },
        { bidderId: 'b3', holdId: 'hold-b3', status: 'HELD' },
      ],
      fromBidderId: null,
      toBidderId: null,
      reason: null,
      capture: null,
      tsMs: 9,
    });
  });
});
