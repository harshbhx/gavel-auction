import { EngineError } from './errors.js';
import { SETTLEMENT_STATES } from './events.js';
import type { BidAudit, RevokeReason, SettlementState } from './events.js';
import type { AuctionConfig, BidSource, LotConfig, Ulid } from './types.js';

interface Base {
  commandId: Ulid;
  at: number;
  auctionId: Ulid;
}

/** Every command (spec section 4.3). */
export type Command =
  | (Base & { type: 'CreateAuction'; title: string; config: Partial<AuctionConfig> })
  | (Base & { type: 'AddLot'; lot: LotConfig })
  | (Base & {
      type: 'RegisterBidder';
      bidderId: Ulid;
      ceilingCents: number;
      holdRef?: string;
      lotId?: Ulid;
    })
  | (Base & { type: 'OpenLot'; lotId: Ulid })
  | (Base & {
      type: 'PlaceBid';
      lotId: Ulid;
      bidderId: Ulid;
      amountCents: number;
      source: BidSource;
      audit: BidAudit;
    })
  | (Base & { type: 'Tick' })
  | (Base & { type: 'Hammer'; lotId: Ulid; early?: boolean; actor: string })
  | (Base & { type: 'RevokeCeiling'; bidderId: Ulid; reason: RevokeReason })
  | (Base & {
      type: 'PromoteRunnerUp';
      lotId: Ulid;
      disqualifiedBidderId: Ulid;
      reason: string;
    })
  | (Base & { type: 'CompleteLot'; lotId: Ulid; capturedCents: number; ref: string })
  | (Base & {
      type: 'RecordSettlement';
      lotId: Ulid;
      from: SettlementState;
      to: SettlementState;
      ref: string;
    })
  | (Base & { type: 'CloseAuction' });

export type CommandType = Command['type'];

export const COMMAND_TYPES = [
  'CreateAuction',
  'AddLot',
  'RegisterBidder',
  'OpenLot',
  'PlaceBid',
  'Tick',
  'Hammer',
  'RevokeCeiling',
  'PromoteRunnerUp',
  'CompleteLot',
  'RecordSettlement',
  'CloseAuction',
] as const satisfies readonly CommandType[];

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BID_SOURCES: readonly string[] = ['voice', 'manual', 'qr'];
const REVOKE_REASONS: readonly string[] = ['declined', 'expired', 'voided', 'other'];
const MODES: readonly string[] = ['english', 'proxy', 'second_price'];
const AUDIT_KEYS = [
  'utteranceId',
  'audioStartMs',
  'audioEndMs',
  'transcript',
  'confidenceBps',
  'confirmed',
  'parserVersion',
  'clientTs',
] as const;
const CONFIG_KEYS: readonly string[] = [
  'currency',
  'holdScope',
  'maxCeilingCents',
  'confirmBelowBps',
  'fallbackPolicy',
  'maxFallbackDepth',
];

type Rec = Record<string, unknown>;

function bad(msg: string): never {
  throw new EngineError('bad_command', msg);
}

function isRec(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function rec(x: unknown, what: string): Rec {
  if (!isRec(x)) return bad(`${what} must be an object`);
  return x;
}

function keysOnly(o: Rec, allowed: readonly string[], what: string): void {
  for (const k of Object.keys(o)) {
    if (FORBIDDEN_KEYS.has(k)) bad(`${what}: forbidden key ${k}`);
    if (!allowed.includes(k)) bad(`${what}: unknown field ${k}`);
  }
}

function int(o: Rec, k: string, what: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isSafeInteger(v))
    return bad(`${what}.${k} must be an integer`);
  return v;
}

function str(o: Rec, k: string, what: string): string {
  const v = o[k];
  if (typeof v !== 'string') return bad(`${what}.${k} must be a string`);
  return v;
}

function ulid(o: Rec, k: string, what: string): Ulid {
  const v = o[k];
  if (typeof v !== 'string' || !ULID_RE.test(v)) return bad(`${what}.${k} must be a ULID`);
  return v as Ulid;
}

function optUlid(o: Rec, k: string, what: string): Ulid | undefined {
  return o[k] === undefined ? undefined : ulid(o, k, what);
}

function oneOf<T extends string>(o: Rec, k: string, allowed: readonly string[], what: string): T {
  const v = o[k];
  if (typeof v !== 'string' || !allowed.includes(v)) return bad(`${what}.${k} is not allowed`);
  return v as T;
}

function parseAudit(x: unknown): BidAudit {
  const o = rec(x, 'audit');
  keysOnly(o, AUDIT_KEYS, 'audit');
  const out: BidAudit = {};
  for (const k of AUDIT_KEYS) {
    if (o[k] === undefined) continue;
    if (k === 'confirmed') {
      const c = o[k];
      if (typeof c !== 'boolean') return bad('audit.confirmed must be a boolean');
      out.confirmed = c;
    } else if (k === 'utteranceId' || k === 'transcript' || k === 'parserVersion') {
      out[k] = str(o, k, 'audit');
    } else {
      const n = int(o, k, 'audit');
      if (k === 'confidenceBps' && (n < 0 || n > 10000)) bad('audit.confidenceBps out of range');
      out[k] = n;
    }
  }
  return out;
}

function parseAuctionConfig(x: unknown): Partial<AuctionConfig> {
  const o = rec(x, 'config');
  keysOnly(o, CONFIG_KEYS, 'config');
  // Value-level checks belong to validateAuctionConfig; shape only here.
  return o as Partial<AuctionConfig>;
}

const LOT_KEYS: readonly string[] = [
  'lotId',
  'title',
  'mode',
  'reserveCents',
  'increment',
  'durationMs',
  'softClose',
  'hammer',
];

function parseLot(x: unknown): LotConfig {
  const o = rec(x, 'lot');
  keysOnly(o, LOT_KEYS, 'lot');
  const increment = rec(o['increment'], 'lot.increment');
  keysOnly(increment, ['flatCents', 'ladder'], 'lot.increment');
  const softClose = rec(o['softClose'], 'lot.softClose');
  keysOnly(softClose, ['windowMs', 'extensionMs', 'maxExtensions', 'hardCloseMs'], 'lot.softClose');
  return {
    lotId: ulid(o, 'lotId', 'lot'),
    title: str(o, 'title', 'lot'),
    mode: oneOf(o, 'mode', MODES, 'lot'),
    reserveCents: int(o, 'reserveCents', 'lot'),
    increment: increment as unknown as LotConfig['increment'],
    durationMs: int(o, 'durationMs', 'lot'),
    softClose: softClose as unknown as LotConfig['softClose'],
    hammer: oneOf(o, 'hammer', ['auto', 'manual'], 'lot'),
  };
}

/**
 * Parses an untrusted value into a Command. Throws EngineError('bad_command')
 * for unknown types, unknown or forbidden fields, and malformed values (R-ENG-089).
 */
export function parseCommand(x: unknown): Command {
  const o = rec(x, 'command');
  const type = o['type'];
  if (typeof type !== 'string' || !(COMMAND_TYPES as readonly string[]).includes(type)) {
    return bad('unknown command type');
  }
  const base = (extra: readonly string[]): Base => {
    keysOnly(o, ['type', 'commandId', 'at', 'auctionId', ...extra], type);
    return {
      commandId: ulid(o, 'commandId', type),
      at: int(o, 'at', type),
      auctionId: ulid(o, 'auctionId', type),
    };
  };
  switch (type as CommandType) {
    case 'CreateAuction':
      return {
        type: 'CreateAuction',
        ...base(['title', 'config']),
        title: str(o, 'title', type),
        config: parseAuctionConfig(o['config']),
      };
    case 'AddLot':
      return { type: 'AddLot', ...base(['lot']), lot: parseLot(o['lot']) };
    case 'RegisterBidder': {
      const b = base(['bidderId', 'ceilingCents', 'holdRef', 'lotId']);
      const cmd: Command = {
        type: 'RegisterBidder',
        ...b,
        bidderId: ulid(o, 'bidderId', type),
        ceilingCents: int(o, 'ceilingCents', type),
      };
      if (o['holdRef'] !== undefined) cmd.holdRef = str(o, 'holdRef', type);
      const lotId = optUlid(o, 'lotId', type);
      if (lotId !== undefined) cmd.lotId = lotId;
      return cmd;
    }
    case 'OpenLot':
      return { type: 'OpenLot', ...base(['lotId']), lotId: ulid(o, 'lotId', type) };
    case 'PlaceBid':
      return {
        type: 'PlaceBid',
        ...base(['lotId', 'bidderId', 'amountCents', 'source', 'audit']),
        lotId: ulid(o, 'lotId', type),
        bidderId: ulid(o, 'bidderId', type),
        amountCents: int(o, 'amountCents', type),
        source: oneOf(o, 'source', BID_SOURCES, type),
        audit: parseAudit(o['audit']),
      };
    case 'Tick':
      return { type: 'Tick', ...base([]) };
    case 'Hammer': {
      const cmd: Command = {
        type: 'Hammer',
        ...base(['lotId', 'early', 'actor']),
        lotId: ulid(o, 'lotId', type),
        actor: str(o, 'actor', type),
      };
      const early = o['early'];
      if (early !== undefined) {
        if (typeof early !== 'boolean') bad('Hammer.early must be a boolean');
        cmd.early = early;
      }
      return cmd;
    }
    case 'RevokeCeiling':
      return {
        type: 'RevokeCeiling',
        ...base(['bidderId', 'reason']),
        bidderId: ulid(o, 'bidderId', type),
        reason: oneOf(o, 'reason', REVOKE_REASONS, type),
      };
    case 'PromoteRunnerUp':
      return {
        type: 'PromoteRunnerUp',
        ...base(['lotId', 'disqualifiedBidderId', 'reason']),
        lotId: ulid(o, 'lotId', type),
        disqualifiedBidderId: ulid(o, 'disqualifiedBidderId', type),
        reason: str(o, 'reason', type),
      };
    case 'CompleteLot':
      return {
        type: 'CompleteLot',
        ...base(['lotId', 'capturedCents', 'ref']),
        lotId: ulid(o, 'lotId', type),
        capturedCents: int(o, 'capturedCents', type),
        ref: str(o, 'ref', type),
      };
    case 'RecordSettlement':
      return {
        type: 'RecordSettlement',
        ...base(['lotId', 'from', 'to', 'ref']),
        lotId: ulid(o, 'lotId', type),
        from: oneOf(o, 'from', SETTLEMENT_STATES, type),
        to: oneOf(o, 'to', SETTLEMENT_STATES, type),
        ref: str(o, 'ref', type),
      };
    case 'CloseAuction':
      return { type: 'CloseAuction', ...base([]) };
  }
}
