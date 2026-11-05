import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type ConnId,
  type EngineBidResult,
  type EngineState,
  type EngineView,
  type EpochMs,
  type RoomEvent,
} from '@gavel/shared';
import { z } from 'zod';
import { MemoryTransport } from '../room/memory-transport';
import { Room, type Connection, type RoomDeps } from '../room/room';
import type { HammerEnginePort, HammerResult, SettlePort } from '../room/settle-port';
import { MemoryStore } from '../store/memory-store';

/**
 * Scenario format: a JSON document of bidders and ordered steps (clock moves, client frames,
 * drops and rejoins). The runner plays it against a real Room on a ManualClock and returns a
 * transcript that is compared to a golden file. No sockets, no wall clock.
 */
const StepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('advance'), ms: z.number().int().nonnegative() }),
  z.object({
    op: z.literal('connect'),
    client: z.string().min(1),
    role: z.enum(['auctioneer', 'bidder', 'screen']),
    bidder: z.string().min(1).optional(),
  }),
  z.object({ op: z.literal('bid'), client: z.string().min(1), amount: z.number().int() }),
  z.object({
    op: z.literal('burst'),
    bids: z.array(z.object({ client: z.string().min(1), amount: z.number().int() })).min(1),
  }),
  z.object({ op: z.literal('drop'), client: z.string().min(1) }),
  z.object({
    op: z.literal('rejoin'),
    client: z.string().min(1),
    lastSeq: z.number().int().nonnegative(),
  }),
  z.object({ op: z.literal('hammer'), client: z.string().min(1) }),
  z.object({ op: z.literal('settle'), state: z.enum(['SETTLED', 'FAILED_NEEDS_REVIEW']) }),
]);

export const ScenarioSchema = z.object({
  name: z.string().min(1),
  bidders: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        ceiling: z.number().int().positive(),
      }),
    )
    .min(1),
  steps: z.array(StepSchema),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioStep = z.infer<typeof StepSchema>;

export interface ScenarioView {
  price: number | null;
  leader: string | null;
  minNext: number | null;
}

export interface ScenarioResult {
  /** Stored events, one line each: `seq:type:detail+msSinceStart`. */
  events: string[];
  /** Projected frames each client received, in order. */
  frames: Record<string, string[]>;
  /** Last known price view of each client. */
  views: Record<string, ScenarioView | null>;
}

export const START_MS = 1_789_000_000_000;

export const SCENARIO_CONFIG = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: START_MS + 600_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 5,
  ceilingPresets: [50000],
  confirmConfidenceThreshold: 0.85,
} as unknown as AuctionConfig;

/** Plain English-auction engine with a hammer; enough to drive the room. */
export class ScenarioEngine implements HammerEnginePort {
  private readonly ceilings = new Map<BidderId, Cents>();
  private readonly top = new Map<BidderId, Cents>();
  private price: Cents | null = null;
  private leader: BidderId | null = null;
  private state: EngineState = 'OPEN';

  constructor(private readonly cfg: AuctionConfig) {}

  register(bidder: BidderId, ceiling: Cents): void {
    this.ceilings.set(bidder, ceiling);
  }

  placeBid(bidder: BidderId, amount: Cents, ts: EpochMs): EngineBidResult {
    if (this.state !== 'OPEN' || ts >= this.cfg.endTs) return { ok: false, code: 'closed' };
    const ceiling = this.ceilings.get(bidder);
    if (ceiling === undefined) return { ok: false, code: 'unregistered' };
    if (this.leader === bidder) return { ok: false, code: 'already_leading' };
    if (amount < this.minNext()) {
      return { ok: false, code: this.price === null ? 'below_reserve' : 'below_increment' };
    }
    if (amount > ceiling) return { ok: false, code: 'over_ceiling' };
    this.price = amount;
    this.leader = bidder;
    this.top.set(bidder, amount);
    return { ok: true };
  }

  tick(now: EpochMs): EngineState {
    if (this.state === 'OPEN' && now >= this.cfg.endTs) this.state = 'CLOSING';
    return this.state;
  }

  hammer(): HammerResult {
    this.state = 'SETTLING';
    const ranking = [...this.top]
      .map(([bidderId, amount]) => ({ bidderId, amount }))
      .sort((a, b) => b.amount - a.amount);
    return { winnerId: this.leader, price: (this.price ?? 0) as Cents, ranking };
  }

  view(): EngineView {
    return {
      state: this.state,
      price: this.price,
      leader: this.leader,
      endTs: this.cfg.endTs,
      extensions: 0,
      minNext: this.minNext(),
    };
  }

  private minNext(): Cents {
    return (this.price === null ? this.cfg.reserve : this.price + this.cfg.minIncrement) as Cents;
  }
}

class NoopSettle implements SettlePort {
  async settle(): Promise<void> {
    return undefined;
  }
}

interface ClientState {
  role: Connection['role'];
  bidderKey: string | undefined;
  conn: Connection;
  transports: MemoryTransport[];
}

type Frame = Record<string, unknown>;

export function parseScenario(json: unknown): Scenario {
  return ScenarioSchema.parse(json);
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const clock = new ManualClock(START_MS);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const deps: RoomDeps = {
    store,
    clock,
    ids,
    engine: (cfg) => new ScenarioEngine(cfg),
    settle: new NoopSettle(),
  };
  const auctionId = ids.mint<'AuctionId'>() as AuctionId;
  const room = await Room.create(auctionId, SCENARIO_CONFIG, 'auctioneer-sub', deps);
  const bidderIds = new Map<string, BidderId>();
  const keyOf = new Map<string, string>();
  for (const b of scenario.bidders) {
    const id = ids.mint<'BidderId'>();
    bidderIds.set(b.key, id);
    keyOf.set(id, b.key);
    await room.registerBidder({
      bidderId: id,
      name: b.name,
      ceiling: b.ceiling as Cents,
      holdRef: `hold-${b.key}`,
    });
  }

  const clients = new Map<string, ClientState>();
  const need = (name: string): ClientState => {
    const c = clients.get(name);
    if (!c) throw new Error(`scenario ${scenario.name}: unknown client ${name}`);
    return c;
  };
  const open = async (
    name: string,
    role: Connection['role'],
    bidderKey: string | undefined,
    lastSeq?: number,
  ): Promise<void> => {
    const transport = new MemoryTransport();
    const bidderId = bidderKey === undefined ? undefined : bidderIds.get(bidderKey);
    const conn: Connection = {
      id: ids.mint<'ConnId'>() as ConnId,
      role,
      sub: bidderKey ?? `${role}-sub`,
      transport,
      ...(bidderId !== undefined ? { bidderId } : {}),
    };
    const prior = clients.get(name);
    clients.set(name, {
      role,
      bidderKey,
      conn,
      transports: [...(prior?.transports ?? []), transport],
    });
    await room.attach(conn, lastSeq);
  };
  const bidMsg = (amount: number) => ({
    v: 1 as const,
    t: 'bid' as const,
    mid: ids.mint<'MsgId'>(),
    amount,
    source: 'qr' as const,
  });
  let rev = 0;

  for (const step of scenario.steps) {
    switch (step.op) {
      case 'advance':
        clock.advance(step.ms);
        break;
      case 'connect':
        await open(step.client, step.role, step.bidder);
        break;
      case 'bid':
        await room.submitBid(need(step.client).conn, bidMsg(step.amount));
        break;
      case 'burst':
        await Promise.all(
          step.bids.map((b) => room.submitBid(need(b.client).conn, bidMsg(b.amount))),
        );
        break;
      case 'drop': {
        const c = need(step.client);
        room.detach(c.conn.id);
        break;
      }
      case 'rejoin': {
        const c = need(step.client);
        await open(step.client, c.role, c.bidderKey, step.lastSeq);
        break;
      }
      case 'hammer':
        await room.control(need(step.client).conn, {
          controlId: `hammer-${step.client}`,
          action: 'hammer',
          args: { closeNow: 1 },
        });
        break;
      case 'settle': {
        rev += 1;
        const perBidder: Record<string, 'SETTLED' | 'FAILED_NEEDS_REVIEW'> = {};
        for (const id of bidderIds.values()) perBidder[id] = step.state;
        await room.reportSettlement({ rev, auctionState: step.state, perBidder });
        break;
      }
    }
  }

  const events = (await store.readEvents(auctionId, 1, 10_000)).map((e) => eventLine(e, keyOf));
  const frames: Record<string, string[]> = {};
  const views: Record<string, ScenarioView | null> = {};
  for (const [name, c] of clients) {
    const all = c.transports.flatMap((t) => t.messages() as Frame[]);
    frames[name] = project(all, keyOf);
    views[name] = lastView(all, keyOf);
  }
  return { events, frames, views };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

function eventLine(e: RoomEvent, keyOf: Map<string, string>): string {
  const r = e as unknown as Record<string, unknown>;
  const who = (v: unknown): string => keyOf.get(str(v)) ?? 'none';
  let detail = '';
  switch (e.type) {
    case 'bidder_registered':
      detail = who(r.bidderId);
      break;
    case 'bid_accepted':
      detail = `${who(r.bidderId)}:${str(r.amount)}`;
      break;
    case 'bid_rejected':
      detail = `${who(r.bidderId)}:${str(r.reason)}`;
      break;
    case 'control':
      detail = str(r.action);
      break;
    case 'hammered':
      detail = `${who(r.winnerId)}:${str(r.price)}`;
      break;
    case 'settlement_update':
      detail = str(r.auctionState);
      break;
    default:
      break;
  }
  const offset = Number(r.ts) - START_MS;
  return `${e.seq}:${e.type}${detail === '' ? '' : `:${detail}`}+${offset}`;
}

function project(all: Frame[], keyOf: Map<string, string>): string[] {
  const out: string[] = [];
  for (const f of all) {
    let line: string | null = null;
    switch (f.t) {
      case 'price':
        line = `price:${str(f.price)}@${str(f.seq)}`;
        break;
      case 'audit_event':
        line = `audit@${str(f.seq)}`;
        break;
      case 'bid_accepted':
        line = `bid_accepted@${str(f.seq)}`;
        break;
      case 'bid_rejected':
        line = `bid_rejected:${str(f.reason)}`;
        break;
      case 'hammer':
        line = `hammer:${keyOf.get(str(f.winnerId)) ?? 'none'}:${str(f.price)}@${str(f.seq)}`;
        break;
      case 'settlement_update':
        line = `settlement:${str(f.auctionState)}`;
        break;
      case 'error':
        line = `error:${str(f.code)}`;
        break;
      default:
        break;
    }
    // A seq filler repeats the price frame of the same seq; keep one.
    if (line !== null && !(f.t === 'price' && out[out.length - 1] === line)) out.push(line);
  }
  return out;
}

function lastView(all: Frame[], keyOf: Map<string, string>): ScenarioView | null {
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const f = all[i];
    if (!f) continue;
    if (f.t === 'price') return viewOf(f, keyOf);
    if (f.t === 'state' && typeof f.snapshot === 'object' && f.snapshot !== null) {
      return viewOf(f.snapshot as Frame, keyOf);
    }
  }
  return null;
}

function viewOf(f: Frame, keyOf: Map<string, string>): ScenarioView {
  const leader = f.leaderId;
  return {
    price: typeof f.price === 'number' ? f.price : null,
    leader: leader === null || leader === undefined ? null : (keyOf.get(str(leader)) ?? 'none'),
    minNext: typeof f.minNext === 'number' ? f.minNext : null,
  };
}
