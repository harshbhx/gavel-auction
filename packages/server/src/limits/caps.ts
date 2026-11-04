export interface CapLimits {
  connectionsPerRoom: number;
  connectionsPerBidder: number;
  biddersPerRoom: number;
  rooms: number;
  bidsPerAuction: number;
}

/** Defaults from R-RT-121. */
export const DEFAULT_CAPS: Readonly<CapLimits> = {
  connectionsPerRoom: 500,
  connectionsPerBidder: 3,
  biddersPerRoom: 200,
  rooms: 20,
  bidsPerAuction: 5000,
};

/** Build limits from the server config names. */
export function capsFromConfig(cfg: {
  MAX_CONN_PER_ROOM: number;
  MAX_CONN_PER_BIDDER: number;
  MAX_BIDDERS_PER_ROOM: number;
  MAX_ROOMS: number;
  MAX_BIDS_PER_AUCTION: number;
}): CapLimits {
  return {
    connectionsPerRoom: cfg.MAX_CONN_PER_ROOM,
    connectionsPerBidder: cfg.MAX_CONN_PER_BIDDER,
    biddersPerRoom: cfg.MAX_BIDDERS_PER_ROOM,
    rooms: cfg.MAX_ROOMS,
    bidsPerAuction: cfg.MAX_BIDS_PER_AUCTION,
  };
}

export const CAP_COUNTERS = [
  'room_full',
  'bidder_superseded',
  'auction_full',
  'rate_limited',
] as const;
export type CapCounter = (typeof CAP_COUNTERS)[number];

export type AdmitResult =
  | { ok: true; superseded?: string }
  | { ok: false; code: 'room_full' | 'auction_full' };

interface RoomUsage {
  /** Connection ids per bidder, oldest first. */
  conns: Map<string, string[]>;
  connTotal: number;
  bidders: Set<string>;
  bids: number;
}

/**
 * Per-instance cap bookkeeping (R-RT-121). Every refusal is counted
 * (R-RT-122); a refusal in one room never touches another room's usage.
 */
export class CapTracker {
  private readonly rooms = new Map<string, RoomUsage>();
  private readonly counts: Record<CapCounter, number> = {
    room_full: 0,
    bidder_superseded: 0,
    auction_full: 0,
    rate_limited: 0,
  };

  constructor(private readonly limits: CapLimits = DEFAULT_CAPS) {}

  /** Count a hit, e.g. a rate-limit refusal reported by another component. */
  count(counter: CapCounter): void {
    this.counts[counter] += 1;
  }

  metrics(): Readonly<Record<CapCounter, number>> {
    return { ...this.counts };
  }

  roomCount(): number {
    return this.rooms.size;
  }

  /** Open a room slot. Re-opening a known room succeeds. */
  admitRoom(auctionId: string): AdmitResult {
    if (this.rooms.has(auctionId)) return { ok: true };
    if (this.rooms.size >= this.limits.rooms) return this.refuse('room_full');
    this.rooms.set(auctionId, { conns: new Map(), connTotal: 0, bidders: new Set(), bids: 0 });
    return { ok: true };
  }

  /** Drop a room and everything counted against it. */
  releaseRoom(auctionId: string): void {
    this.rooms.delete(auctionId);
  }

  /**
   * Admit one connection. A bidder over its connection cap supersedes its
   * oldest connection; the caller closes the returned id.
   */
  admitConnection(auctionId: string, bidderId: string, connId: string): AdmitResult {
    const room = this.rooms.get(auctionId);
    if (!room) return this.refuse('room_full');
    const mine = room.conns.get(bidderId) ?? [];
    const superseded = mine.length >= this.limits.connectionsPerBidder ? mine[0] : undefined;
    const net = room.connTotal - (superseded === undefined ? 0 : 1) + 1;
    if (net > this.limits.connectionsPerRoom) return this.refuse('room_full');
    if (!room.bidders.has(bidderId) && room.bidders.size >= this.limits.biddersPerRoom) {
      return this.refuse('room_full');
    }
    if (superseded !== undefined) {
      mine.shift();
      room.connTotal -= 1;
      this.count('bidder_superseded');
    }
    mine.push(connId);
    room.conns.set(bidderId, mine);
    room.connTotal += 1;
    room.bidders.add(bidderId);
    return superseded === undefined ? { ok: true } : { ok: true, superseded };
  }

  /** Forget a closed connection. Unknown ids are ignored. */
  releaseConnection(auctionId: string, bidderId: string, connId: string): void {
    const room = this.rooms.get(auctionId);
    const mine = room?.conns.get(bidderId);
    if (!room || !mine) return;
    const at = mine.indexOf(connId);
    if (at < 0) return;
    mine.splice(at, 1);
    room.connTotal -= 1;
    if (mine.length === 0) room.conns.delete(bidderId);
  }

  /** Count one bid against the auction. Refused bids are not counted. */
  admitBid(auctionId: string): AdmitResult {
    const room = this.rooms.get(auctionId);
    if (!room) return this.refuse('room_full');
    if (room.bids >= this.limits.bidsPerAuction) return this.refuse('auction_full');
    room.bids += 1;
    return { ok: true };
  }

  private refuse(code: 'room_full' | 'auction_full'): AdmitResult {
    this.count(code);
    return { ok: false, code };
  }
}
