import { describe, expect, it } from 'vitest';

// Judge rooms on a deployed sandbox host. Skipped unless GAVEL_JUDGE_API_URL names the API origin
// (the host must run with JUDGE_ROOMS=true). It creates one room with no operator key, reads it
// back, checks that the room token cannot reach operator routes, and ends the room.
// Run: GAVEL_JUDGE_API_URL=https://<api-host> npm run test:sandbox -w @gavel/e2e

const api = (process.env['GAVEL_JUDGE_API_URL'] ?? '').replace(/\/+$/, '');

interface Room {
  auctionId: string;
  joinCode: string;
  auctioneerToken: string;
}

describe.skipIf(api === '')('sandbox judge rooms', () => {
  it('opens a real room without the operator key and keeps its token in the room', async () => {
    const caps = (await (await fetch(`${api}/api/judge/capabilities`)).json()) as {
      judgeRooms?: boolean;
      accepting?: boolean;
    };
    expect(caps.judgeRooms).toBe(true);
    expect(caps.accepting).toBe(true);

    const made = await fetch(`${api}/api/judge/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(made.status).toBe(201);
    const room = (await made.json()) as Room;
    const bearer = { authorization: `Bearer ${room.auctioneerToken}` };

    const read = await fetch(`${api}/api/auctions/${room.joinCode}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { auctionId: string }).auctionId).toBe(room.auctionId);

    expect((await fetch(`${api}/ops/rooms`, { headers: bearer })).status).toBe(401);
    expect(
      (
        await fetch(`${api}/api/judge/pause`, {
          method: 'POST',
          headers: { ...bearer, 'content-type': 'application/json' },
          body: JSON.stringify({ paused: true }),
        })
      ).status,
    ).toBe(401);

    const stop = await fetch(`${api}/api/auctions/${room.auctionId}/kill`, {
      method: 'POST',
      headers: { ...bearer, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(stop.status).toBe(200);
  });
});
