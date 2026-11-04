import { describe, expect, it } from 'vitest';
import { CapTracker, DEFAULT_CAPS, capsFromConfig } from '../src/limits/caps';

const A = 'auction-a';
const B = 'auction-b';

describe('caps (T-RT-088)', () => {
  it('refuses the 501st connection in a room with room_full', () => {
    const caps = new CapTracker({ ...DEFAULT_CAPS, biddersPerRoom: 1000 });
    caps.admitRoom(A);
    for (let i = 0; i < 500; i++) {
      expect(caps.admitConnection(A, `bidder-${i}`, `c${i}`).ok).toBe(true);
    }
    expect(caps.admitConnection(A, 'bidder-500', 'c500')).toEqual({ ok: false, code: 'room_full' });
    expect(caps.metrics().room_full).toBe(1);
  });

  it('supersedes the oldest connection when a bidder opens a 4th', () => {
    const caps = new CapTracker();
    caps.admitRoom(A);
    for (const id of ['c1', 'c2', 'c3']) expect(caps.admitConnection(A, 'x', id).ok).toBe(true);
    expect(caps.admitConnection(A, 'x', 'c4')).toEqual({ ok: true, superseded: 'c1' });
    expect(caps.metrics().bidder_superseded).toBe(1);
  });

  it('refuses the 201st distinct bidder with room_full', () => {
    const caps = new CapTracker();
    caps.admitRoom(A);
    for (let i = 0; i < 200; i++) {
      expect(caps.admitConnection(A, `bidder-${i}`, `c${i}`).ok).toBe(true);
    }
    expect(caps.admitConnection(A, 'bidder-200', 'c200')).toEqual({ ok: false, code: 'room_full' });
    // A known bidder may still reconnect.
    expect(caps.admitConnection(A, 'bidder-0', 'again').ok).toBe(true);
  });

  it('refuses the 5001st bid with auction_full', () => {
    const caps = new CapTracker();
    caps.admitRoom(A);
    for (let i = 0; i < 5000; i++) expect(caps.admitBid(A).ok).toBe(true);
    expect(caps.admitBid(A)).toEqual({ ok: false, code: 'auction_full' });
    expect(caps.metrics().auction_full).toBe(1);
  });

  it('refuses the 21st room and frees a slot on release', () => {
    const caps = new CapTracker();
    for (let i = 0; i < 20; i++) expect(caps.admitRoom(`r${i}`).ok).toBe(true);
    expect(caps.admitRoom('r20')).toEqual({ ok: false, code: 'room_full' });
    expect(caps.admitRoom('r0').ok).toBe(true);
    caps.releaseRoom('r0');
    expect(caps.admitRoom('r20').ok).toBe(true);
  });

  it('a full room does not affect another room', () => {
    const caps = new CapTracker({ ...DEFAULT_CAPS, bidsPerAuction: 1 });
    caps.admitRoom(A);
    caps.admitRoom(B);
    expect(caps.admitBid(A).ok).toBe(true);
    expect(caps.admitBid(A).ok).toBe(false);
    expect(caps.admitBid(B).ok).toBe(true);
  });

  it('releasing a connection frees a slot', () => {
    const caps = new CapTracker({ ...DEFAULT_CAPS, connectionsPerRoom: 1 });
    caps.admitRoom(A);
    caps.admitConnection(A, 'x', 'c1');
    expect(caps.admitConnection(A, 'y', 'c2').ok).toBe(false);
    caps.releaseConnection(A, 'x', 'c1');
    expect(caps.admitConnection(A, 'y', 'c2').ok).toBe(true);
  });

  it('refuses work for an unknown room without throwing', () => {
    const caps = new CapTracker();
    expect(caps.admitConnection('nope', 'x', 'c1').ok).toBe(false);
    expect(caps.admitBid('nope').ok).toBe(false);
  });

  it('counts external rate-limit hits', () => {
    const caps = new CapTracker();
    caps.count('rate_limited');
    expect(caps.metrics().rate_limited).toBe(1);
  });

  it('reads limits from config names', () => {
    expect(
      capsFromConfig({
        MAX_CONN_PER_ROOM: 5,
        MAX_CONN_PER_BIDDER: 2,
        MAX_BIDDERS_PER_ROOM: 4,
        MAX_ROOMS: 3,
        MAX_BIDS_PER_AUCTION: 9,
      }),
    ).toEqual({
      connectionsPerRoom: 5,
      connectionsPerBidder: 2,
      biddersPerRoom: 4,
      rooms: 3,
      bidsPerAuction: 9,
    });
  });
});
