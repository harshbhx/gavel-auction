import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeBatch } from '@gavel/voice';
import { describe, expect, it } from 'vitest';
import { startStack } from '../src/runner/stack';
import { connectAudio, setUpRoom, sleep, type SockCtor } from '../src/voice/live-room';
import { FRAME_SAMPLES, LIVE_STACK_ENV } from '../src/voice/live-socket';

// The live /audio socket run, up to its first streamed frame and with no speech provider: create a
// room, enrol bidders, check the lot is open (a room is open from creation; asking to open it again
// answered 409 in the second dispatch), open /audio with the auctioneer token, wait for ready and
// send one batch of silence. This is the same code the run uses, against the real server process
// and the fake PayPal, so the sequence cannot regress unnoticed.

const SERVER_DIR = fileURLToPath(new URL('../../server', import.meta.url));
const TIMEOUT_MS = 120_000;

describe('live socket run, up to the first streamed frame', () => {
  it(
    'sets up the room, finds the lot open, gets ready from /audio and accepts a frame',
    async () => {
      const make = createRequire(join(SERVER_DIR, 'package.json'))('ws') as SockCtor;
      const stack = await startStack({ externalFake: true, env: { ...LIVE_STACK_ENV } });
      try {
        const room = await setUpRoom(stack, make, 2);
        expect(room.bidderSockets).toHaveLength(2);
        const states = room.seen.filter((s) => s.frame['t'] === 'state');
        expect(states.length).toBeGreaterThanOrEqual(2);

        const audio = await connectAudio(stack, make, room);
        expect(audio.isReady()).toBe(true);
        audio.sock.send(
          encodeBatch({ seq: 0, tsMs: 0, flags: 0, pcm: new Int16Array(FRAME_SAMPLES * 5) }),
        );
        await sleep(500);
        expect(audio.closeCode()).toBeUndefined();

        audio.sock.close(1000);
        for (const s of room.bidderSockets) s.close();
      } finally {
        await stack.stop();
      }
    },
    TIMEOUT_MS,
  );
});
