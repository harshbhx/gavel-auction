import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { evolveAll } from '@gavel/engine';
import { Handshake } from '@gavel/server/src/transport/handshake';
import { decodeClientMsg, encodeMsg } from '@gavel/shared';
import { loadScenarioFile } from '../src/index';
import { enroll, makeRig, connect, ledgerKey } from './flow/rig';
import { scenarioConfig } from './flow/scenario-runner';

// T-QA-038 (R-QA-026): the hostile frames of scenario S10 go through the server's raw-frame path
// (Handshake.receive, then onFrame on a joined connection) into a real room, and the auction must
// stay untouched. The socket host is not mounted yet, so onFrame is the decode-then-dispatch a host
// performs: a refused frame is answered with an error frame and never reaches the room.

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scenario = loadScenarioFile(join(ROOT, 'scenarios', 'S10-abusive-input.yaml'));
const raws = scenario.steps.flatMap((s) => (s.do === 'send_raw' ? [s.frame] : []));

const open: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => {
  for (const p of open.splice(0)) await p.stop();
});

describe('S10 hostile frames through the composed server path', () => {
  it('refuses each frame with bad_message and leaves the auction untouched', async () => {
    const rig = await makeRig();
    open.push(rig.paypal);
    rig.clock.set(scenario.clock.startMs);
    const service = rig.service();
    const auctionId = rig.ids.mint<'AuctionId'>();
    const config = scenarioConfig(scenario);
    const presets = (config as unknown as { ceilingPresets: number[] }).ceilingPresets;
    const room = await service.createAuction(auctionId, config, 'auctioneer-sub');
    const mallory = await enroll(rig, service, room, auctionId, 'mallory', 20000, presets);
    const boss = await connect(rig, room, 'auctioneer');

    const closes: Array<{ code: number; reason: string }> = [];
    const hs = new Handshake({
      clock: rig.clock,
      send: (t) => mallory.transport.send(t),
      close: (code, reason) => closes.push({ code, reason }),
      ping: () => undefined,
      onJoin: () => undefined,
      onFrame: async (raw) => {
        const res = decodeClientMsg(raw);
        if (!res.ok) {
          const out = encodeMsg({ v: 1, t: 'error', code: res.code, message: res.code });
          if (out.ok) mallory.transport.send(out.value);
          return;
        }
        if (res.value.t === 'bid') await room.submitBid(mallory.conn, res.value);
      },
    });
    await hs.receive(JSON.stringify({ v: 1, t: 'join', token: 'placeholder', auctionId }));
    expect(hs.hasJoined).toBe(true);

    const before = mallory.transport.messages('error').length;
    for (const frame of raws) await hs.receive(frame);
    const errors = mallory.transport.messages('error').slice(before);
    expect(errors.map((e) => e['code'])).toEqual(raws.map(() => 'bad_message'));
    expect(closes).toEqual([]);

    await room.control(boss.conn, {
      controlId: 'hammer-s10',
      action: 'hammer',
      args: { closeNow: 1 },
    });
    await service.idle();
    const entries = await rig.stores.ledger.read(ledgerKey(auctionId), 1);
    expect(entries.filter((e) => e.type === 'BID_RECORDED')).toHaveLength(0);
    expect(evolveAll(entries).lots[auctionId]?.winnerId ?? null).toBeNull();
    expect(rig.paypal.core.getAuthorization(mallory.authId).captures).toHaveLength(0);
    await service.close();
  });
});
