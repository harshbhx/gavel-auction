import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkJudgeKey,
  forgetJudgeKey,
  JUDGE_KEY_HEADER,
  judgeKeyOffered,
  readJudgeKey,
  rememberJudgeKey,
} from '../../src/net/judgeKey';
import { createJudgeRoom, fetchRoomLedger } from '../../src/net/judgeRooms';
import { DemoRoomError } from '../../src/screens/demo/DemoLauncher';
import { forgetHubKeys, latestHubRoom } from '../../src/screens/hub/hubKeys';

// Test-only constants, built at run time.
const KEY = ['test', 'judge', 'k'.repeat(32)].join('-');
const API = 'https://api.example.test';

afterEach(() => {
  vi.unstubAllGlobals();
  forgetJudgeKey();
  forgetHubKeys();
});

function stub(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('judge key storage', () => {
  beforeEach(() => forgetJudgeKey());

  it('keeps the key in sessionStorage only, and forgets it', () => {
    expect(readJudgeKey()).toBeNull();
    rememberJudgeKey(KEY);
    expect(readJudgeKey()).toBe(KEY);
    expect(window.sessionStorage.length).toBe(1);
    expect(window.localStorage.length).toBe(0);
    forgetJudgeKey();
    expect(readJudgeKey()).toBeNull();
  });

  it('survives a browser that blocks storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readJudgeKey()).toBeNull();
    expect(() => rememberJudgeKey(KEY)).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('judge key calls', () => {
  it('reads whether the host offers a key', async () => {
    stub(200, { judgeRooms: true, accepting: true, keyed: true });
    expect(await judgeKeyOffered(API)).toBe(true);
    stub(200, { judgeRooms: true, accepting: true });
    expect(await judgeKeyOffered(API)).toBe(false);
    stub(404, {});
    expect(await judgeKeyOffered(API)).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down'))),
    );
    expect(await judgeKeyOffered(API)).toBe(false);
  });

  it('sends the key in a header, never in the URL, and maps the answer', async () => {
    const fn = stub(200, { ok: true });
    expect(await checkJudgeKey(API, KEY)).toBe('ok');
    const call = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).not.toContain(KEY);
    expect(String(call[1].body)).not.toContain(KEY);
    expect((call[1].headers as Record<string, string>)[JUDGE_KEY_HEADER]).toBe(KEY);
    stub(401, { error: 'judge_key_invalid' });
    expect(await checkJudgeKey(API, KEY)).toBe('wrong');
    stub(429, { error: 'judge_key_locked' });
    expect(await checkJudgeKey(API, KEY)).toBe('locked');
    stub(500, {});
    expect(await checkJudgeKey(API, KEY)).toBe('unreachable');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down'))),
    );
    expect(await checkJudgeKey(API, KEY)).toBe('unreachable');
  });
});

const CREATED = {
  auctionId: 'room-1',
  joinCode: 'ABC234',
  auctioneerToken: 'aud-token',
  screenToken: 'scr-token',
  reviewerToken: 'rev-token',
  expiresAt: 1_900_000_000_000,
};

describe('createJudgeRoom with a key', () => {
  it('sends no key header on the public path', async () => {
    const fn = stub(201, CREATED);
    await createJudgeRoom(API);
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(Object.keys(init.headers as object)).not.toContain(JUDGE_KEY_HEADER);
  });

  it('sends the key as a header, keeps it out of every link and returns a working audit link', async () => {
    const fn = stub(201, CREATED);
    const links = await createJudgeRoom(API, undefined, KEY);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/api/judge/rooms`);
    expect((init.headers as Record<string, string>)[JUDGE_KEY_HEADER]).toBe(KEY);
    expect(JSON.stringify(links)).not.toContain(KEY);
    expect(links.audit).toBe('/r/room-1/audit#token=rev-token');
    expect(links.console).toBe('/r/room-1/console#token=aud-token');
    expect(links.hub).toContain('review=rev-token');
    expect(latestHubRoom()?.keys.reviewer).toBe('rev-token');
  });

  it('falls back to an audit path without a token when the host sent no reviewer token', async () => {
    stub(201, { ...CREATED, reviewerToken: undefined });
    const links = await createJudgeRoom(API);
    expect(links.audit).toBe('/r/room-1/audit');
  });

  it('names a wrong key, a lockout and the keyed room cap', async () => {
    stub(401, { error: 'judge_key_invalid' });
    await expect(createJudgeRoom(API, undefined, KEY)).rejects.toMatchObject({
      reason: 'keyWrong',
    });
    stub(429, { error: 'judge_key_locked' });
    await expect(createJudgeRoom(API, undefined, KEY)).rejects.toMatchObject({
      reason: 'keyLocked',
    });
    stub(429, { error: 'judge_key_room_cap' });
    await expect(createJudgeRoom(API, undefined, KEY)).rejects.toMatchObject({ reason: 'keyCap' });
    stub(429, { error: 'judge_room_cap' });
    await expect(createJudgeRoom(API, undefined, KEY)).rejects.toBeInstanceOf(DemoRoomError);
    stub(429, { error: 'judge_room_cap' });
    await expect(createJudgeRoom(API)).rejects.toMatchObject({ reason: 'judgeBusy' });
  });
});

describe('fetchRoomLedger', () => {
  it('sends the reviewer token as a bearer header and maps the answers', async () => {
    const fn = stub(200, { version: 1 });
    expect(await fetchRoomLedger(API, 'room-1', 'rev-token')).toEqual({
      kind: 'ok',
      ledger: { version: 1 },
    });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/api/judge/rooms/room-1/ledger`);
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer rev-token');
    stub(404, {});
    expect(await fetchRoomLedger(API, 'room-1', 'x')).toEqual({ kind: 'notYet' });
    stub(401, {});
    expect(await fetchRoomLedger(API, 'room-1', 'x')).toEqual({ kind: 'denied' });
    stub(500, {});
    expect(await fetchRoomLedger(API, 'room-1', 'x')).toEqual({ kind: 'failed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down'))),
    );
    expect(await fetchRoomLedger(API, 'room-1', 'x')).toEqual({ kind: 'failed' });
  });
});
