import { MAX_AMOUNT_CENTS } from './types.js';
import type { AuctionConfig, IncrementRule, LotConfig, Mode, SoftClose } from './types.js';

export interface ConfigError {
  path: string;
  code: string;
  message: string;
}
export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E };

export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  currency: 'USD',
  holdScope: 'event',
  maxCeilingCents: 5_000_000_000,
  confirmBelowBps: 8500,
  fallbackPolicy: 'runner_up',
  maxFallbackDepth: 2,
};

/**
 * The defaults an `AUCTION_CREATED` entry written before D-0032 was filled from at replay. Such
 * entries carry only the fields the caller passed; replay fills the rest from this frozen copy,
 * never from the current `DEFAULT_AUCTION_CONFIG`, so a later change of a default cannot change
 * what an existing ledger means (R12-E13). New entries carry the whole validated config.
 */
export const LEDGER_V1_AUCTION_DEFAULTS: Readonly<AuctionConfig> = Object.freeze<AuctionConfig>({
  currency: 'USD',
  holdScope: 'event',
  maxCeilingCents: 100000,
  confirmBelowBps: 8500,
  fallbackPolicy: 'runner_up',
  maxFallbackDepth: 2,
});

/** The whole config an `AUCTION_CREATED` payload stands for, old partial payloads included. */
export function createdConfig(config: Partial<AuctionConfig>): AuctionConfig {
  return { ...LEDGER_V1_AUCTION_DEFAULTS, ...config };
}

export const DEFAULT_LOT_DEFAULTS = {
  hammer: 'auto',
  increment: { flatCents: 100 },
  softClose: { windowMs: 0, extensionMs: 0, maxExtensions: 10 },
} as const;

const MODES: readonly Mode[] = ['english', 'proxy', 'second_price'];
const MAX_MS = 600000;
type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x);
}
function inRange(x: unknown, lo: number, hi: number): x is number {
  return isInt(x) && x >= lo && x <= hi;
}

export function validateAuctionConfig(x: unknown): Result<AuctionConfig, ConfigError[]> {
  const errors: ConfigError[] = [];
  const add = (path: string, code: string, message: string): void => {
    errors.push({ path, code, message });
  };
  if (x !== undefined && !isRec(x)) {
    return { ok: false, errors: [{ path: '', code: 'bad_config', message: 'must be an object' }] };
  }
  const o: Rec = x ?? {};
  const v: AuctionConfig = { ...DEFAULT_AUCTION_CONFIG };
  const known = Object.keys(DEFAULT_AUCTION_CONFIG);
  for (const k of Object.keys(o)) {
    if (!known.includes(k)) add(k, 'unknown_field', `unknown field ${k}`);
  }
  if (o['currency'] !== undefined) {
    if (o['currency'] !== 'USD') add('currency', 'unsupported_currency', 'only USD is supported');
  }
  if (o['holdScope'] !== undefined) {
    if (o['holdScope'] === 'event' || o['holdScope'] === 'lot') v.holdScope = o['holdScope'];
    else add('holdScope', 'bad_value', 'holdScope must be event or lot');
  }
  if (o['maxCeilingCents'] !== undefined) {
    if (inRange(o['maxCeilingCents'], 100, 5_000_000_000)) v.maxCeilingCents = o['maxCeilingCents'];
    else
      add('maxCeilingCents', 'bad_value', 'maxCeilingCents must be an integer in 100..5000000000');
  }
  if (o['confirmBelowBps'] !== undefined) {
    if (inRange(o['confirmBelowBps'], 0, 10000)) v.confirmBelowBps = o['confirmBelowBps'];
    else add('confirmBelowBps', 'bad_value', 'confirmBelowBps must be an integer in 0..10000');
  }
  if (o['fallbackPolicy'] !== undefined) {
    if (o['fallbackPolicy'] === 'runner_up' || o['fallbackPolicy'] === 'unsold') {
      v.fallbackPolicy = o['fallbackPolicy'];
    } else add('fallbackPolicy', 'bad_value', 'fallbackPolicy must be runner_up or unsold');
  }
  if (o['maxFallbackDepth'] !== undefined) {
    if (inRange(o['maxFallbackDepth'], 0, 10)) v.maxFallbackDepth = o['maxFallbackDepth'];
    else add('maxFallbackDepth', 'bad_value', 'maxFallbackDepth must be an integer in 0..10');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: v };
}

function validateIncrement(
  x: unknown,
  add: (path: string, code: string, message: string) => void,
): IncrementRule {
  if (x === undefined) return { ...DEFAULT_LOT_DEFAULTS.increment };
  if (!isRec(x)) {
    add('increment', 'bad_increment', 'increment must be an object');
    return { ...DEFAULT_LOT_DEFAULTS.increment };
  }
  if (x['flatCents'] !== undefined && x['ladder'] === undefined) {
    if (!inRange(x['flatCents'], 1, MAX_AMOUNT_CENTS)) {
      add('increment.flatCents', 'bad_increment', 'flatCents must be an integer in 1..100000000');
      return { ...DEFAULT_LOT_DEFAULTS.increment };
    }
    return { flatCents: x['flatCents'] };
  }
  const ladder = x['ladder'];
  if (x['flatCents'] !== undefined || !Array.isArray(ladder) || ladder.length === 0) {
    add('increment', 'bad_increment', 'increment must be {flatCents} or a non-empty {ladder}');
    return { ...DEFAULT_LOT_DEFAULTS.increment };
  }
  const out: Array<{ fromCents: number; incrementCents: number }> = [];
  let prev = -1;
  ladder.forEach((raw: unknown, i: number) => {
    const p = `increment.ladder[${i}]`;
    if (!isRec(raw)) {
      add(p, 'bad_increment', 'ladder entry must be an object');
      return;
    }
    const from = raw['fromCents'];
    const inc = raw['incrementCents'];
    if (!inRange(from, 0, MAX_AMOUNT_CENTS)) {
      add(`${p}.fromCents`, 'bad_increment', 'fromCents must be an integer in 0..100000000');
    } else {
      if (i === 0 && from !== 0) {
        add(`${p}.fromCents`, 'bad_increment', 'ladder first fromCents must be 0');
      }
      if (i > 0 && from <= prev) {
        add(`${p}.fromCents`, 'bad_increment', 'fromCents must strictly increase');
      }
      prev = from;
    }
    if (!inRange(inc, 1, MAX_AMOUNT_CENTS)) {
      add(
        `${p}.incrementCents`,
        'bad_increment',
        'incrementCents must be an integer in 1..100000000',
      );
    }
    if (isInt(from) && isInt(inc)) out.push({ fromCents: from, incrementCents: inc });
  });
  return { ladder: out };
}

function validateSoftClose(
  x: unknown,
  mode: Mode | undefined,
  durationMs: number | undefined,
  add: (path: string, code: string, message: string) => void,
): SoftClose {
  const d = DEFAULT_LOT_DEFAULTS.softClose;
  const out: SoftClose = { ...d };
  if (x === undefined) return out;
  if (!isRec(x)) {
    add('softClose', 'bad_value', 'softClose must be an object');
    return out;
  }
  if (x['windowMs'] !== undefined) {
    if (inRange(x['windowMs'], 0, MAX_MS)) out.windowMs = x['windowMs'];
    else add('softClose.windowMs', 'bad_value', 'windowMs must be an integer in 0..600000');
  }
  if (x['extensionMs'] !== undefined) {
    if (inRange(x['extensionMs'], 0, MAX_MS)) out.extensionMs = x['extensionMs'];
    else add('softClose.extensionMs', 'bad_value', 'extensionMs must be an integer in 0..600000');
  }
  if (x['maxExtensions'] !== undefined) {
    if (inRange(x['maxExtensions'], 0, 50)) out.maxExtensions = x['maxExtensions'];
    else add('softClose.maxExtensions', 'bad_value', 'maxExtensions must be an integer in 0..50');
  }
  if (x['hardCloseMs'] !== undefined) {
    if (!isInt(x['hardCloseMs'])) {
      add('softClose.hardCloseMs', 'bad_value', 'hardCloseMs must be an integer');
    } else if (durationMs !== undefined && x['hardCloseMs'] < durationMs) {
      add('softClose.hardCloseMs', 'bad_value', 'hardCloseMs must be >= durationMs');
    } else out.hardCloseMs = x['hardCloseMs'];
  }
  if (mode === 'second_price' && isInt(x['windowMs']) && x['windowMs'] > 0) {
    add('softClose.windowMs', 'soft_close_not_allowed_sealed', 'sealed lots cannot soft close');
  }
  return out;
}

export function validateLotConfig(x: unknown): Result<LotConfig, ConfigError[]> {
  const errors: ConfigError[] = [];
  const add = (path: string, code: string, message: string): void => {
    errors.push({ path, code, message });
  };
  if (!isRec(x)) {
    return { ok: false, errors: [{ path: '', code: 'bad_config', message: 'must be an object' }] };
  }
  const known = [
    'lotId',
    'title',
    'mode',
    'reserveCents',
    'increment',
    'durationMs',
    'softClose',
    'hammer',
  ];
  for (const k of Object.keys(x)) {
    if (!known.includes(k)) add(k, 'unknown_field', `unknown field ${k}`);
  }
  const lotId = typeof x['lotId'] === 'string' ? x['lotId'] : '';
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(lotId)) add('lotId', 'bad_id', 'lotId must be a ULID');
  const title = typeof x['title'] === 'string' ? x['title'] : '';
  if (typeof x['title'] !== 'string' || title.length === 0 || title.length > 120) {
    add('title', 'bad_value', 'title must be a string of 1..120 characters');
  }
  let mode: Mode | undefined;
  if (typeof x['mode'] === 'string' && (MODES as readonly string[]).includes(x['mode'])) {
    mode = x['mode'] as Mode;
  } else add('mode', 'bad_value', 'mode must be english, proxy or second_price');
  if (!inRange(x['reserveCents'], 1, MAX_AMOUNT_CENTS)) {
    add('reserveCents', 'bad_value', 'reserve must be an integer in 1..100000000 cents');
  }
  let durationMs: number | undefined;
  if (inRange(x['durationMs'], 1000, 86_400_000)) durationMs = x['durationMs'];
  else add('durationMs', 'bad_value', 'durationMs must be an integer in 1000..86400000');
  let hammer: 'auto' | 'manual' = DEFAULT_LOT_DEFAULTS.hammer;
  if (x['hammer'] !== undefined) {
    if (x['hammer'] === 'auto' || x['hammer'] === 'manual') hammer = x['hammer'];
    else add('hammer', 'bad_value', 'hammer must be auto or manual');
  }
  const increment = validateIncrement(x['increment'], add);
  const softClose = validateSoftClose(x['softClose'], mode, durationMs, add);
  if (errors.length > 0 || mode === undefined || durationMs === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      lotId: lotId as LotConfig['lotId'],
      title,
      mode,
      reserveCents: x['reserveCents'] as number,
      increment,
      durationMs,
      softClose,
      hammer,
    },
  };
}

/** R-ENG-013: RegisterBidder carries lotId if and only if holdScope is `lot`. */
export function validateRegisterScope(
  holdScope: AuctionConfig['holdScope'],
  cmd: { lotId?: string },
): Result<null, ConfigError[]> {
  const has = cmd.lotId !== undefined;
  if (holdScope === 'lot' && !has) {
    return {
      ok: false,
      errors: [
        { path: 'lotId', code: 'bad_command', message: 'lotId is required when holdScope is lot' },
      ],
    };
  }
  if (holdScope === 'event' && has) {
    return {
      ok: false,
      errors: [
        {
          path: 'lotId',
          code: 'bad_command',
          message: 'lotId is not allowed when holdScope is event',
        },
      ],
    };
  }
  return { ok: true, value: null };
}
