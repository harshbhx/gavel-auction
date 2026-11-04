import { ERROR_CODES, parseId } from '@gavel/shared';
import type { BidderId, ErrorCode } from '@gavel/shared';
import { z } from 'zod';
import type { Checkpoint, Scenario } from './types';

// Cents and EpochMs are branded numbers: the schema validates the raw number and
// declares the branded output type.
const cents = z.number().int().nonnegative().safe() as unknown as z.ZodType<
  Scenario['auction']['reserve'],
  z.ZodTypeDef,
  number
>;
const epochMs = z.number().int().nonnegative().safe() as unknown as z.ZodType<
  Scenario['clock']['startMs'],
  z.ZodTypeDef,
  number
>;
const ms = z.number().int().nonnegative();
const name = z.string().min(1);
const funding = z.enum(['wallet', 'card']);

const checkpoint = z.custom<Checkpoint>(
  (v) =>
    typeof v === 'string' &&
    (v === 'after_winner_selected' ||
      v === 'before_capture_request' ||
      v === 'after_capture_request_before_response' ||
      v === 'after_capture_recorded' ||
      v === 'before_final_ledger' ||
      /^during_void_loop:\d+$/.test(v)),
  'unknown checkpoint',
);

export const FaultSchema = z.union([
  z
    .object({
      at: z.literal('paypal.capture'),
      kind: z.literal('http'),
      status: z.union([z.literal(500), z.literal(502), z.literal(503), z.literal(429)]),
      times: z.number().int().positive(),
    })
    .strict(),
  z.object({ at: z.literal('paypal.capture'), kind: z.literal('timeout_after_commit') }).strict(),
  z
    .object({
      at: z.literal('paypal.void'),
      kind: z.literal('http'),
      status: z.literal(500),
      times: z.number().int().positive(),
      bidder: name.optional(),
    })
    .strict(),
  z
    .object({
      at: z.literal('paypal.authorization'),
      kind: z.enum(['expire', 'void_external', 'decline']),
      bidder: name,
    })
    .strict(),
  z
    .object({
      at: z.literal('webhook'),
      kind: z.enum(['duplicate', 'delay', 'reorder']),
      event: name,
      times: z.number().int().positive().optional(),
      ms: ms.optional(),
    })
    .strict(),
  z.object({ at: z.literal('server'), kind: z.literal('kill'), checkpoint }).strict(),
  z
    .object({
      at: z.literal('stt'),
      kind: z.enum(['timeout', 'garbage', 'low_confidence']),
      times: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ at: z.literal('ws'), kind: z.literal('drop'), client: name, forMs: ms }).strict(),
]);

export const StepSchema = z.discriminatedUnion('do', [
  z
    .object({
      t: ms,
      actor: name,
      do: z.literal('register'),
      ceiling: cents,
      funding: funding.optional(),
    })
    .strict(),
  z
    .object({
      t: ms,
      actor: name,
      do: z.literal('bid'),
      amount: cents,
      via: z.enum(['qr', 'voice', 'manual']).optional(),
    })
    .strict(),
  z.object({ t: ms, actor: name, do: z.literal('say'), audio: name }).strict(),
  z.object({ t: ms, actor: name, do: z.literal('confirm'), accept: z.boolean() }).strict(),
  z
    .object({
      t: ms,
      actor: z.literal('auctioneer'),
      do: z.enum(['open', 'pause', 'resume', 'extend', 'hammer']),
    })
    .strict(),
  z.object({ t: ms, actor: name, do: z.enum(['disconnect', 'reconnect']) }).strict(),
  z.object({ t: ms, actor: name, do: z.literal('send_raw'), frame: z.string() }).strict(),
  z.object({ t: ms, do: z.literal('advance_clock'), ms }).strict(),
  z.object({ t: ms, do: z.literal('fault'), fault: FaultSchema }).strict(),
]);

const settlementState = z.enum([
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'CAPTURED',
  'VOIDING',
  'SETTLED',
  'FALLBACK_RUNNER_UP',
  'FAILED_NEEDS_REVIEW',
]);

const errorCode = z.custom<ErrorCode>(
  (v) => typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v),
  'unknown error code',
);

export const ExpectSchema = z.union([
  z
    .object({
      ledger: z
        .object({
          winner: z.string().nullable(),
          captured: cents,
          released: cents,
          voided: z.array(name),
        })
        .strict(),
    })
    .strict(),
  z.object({ settlement: z.record(name, settlementState) }).strict(),
  z.object({ invariants: z.array(z.enum(['I1', 'I2', 'I3', 'I4', 'I5'])) }).strict(),
  z.object({ rejected: z.array(z.object({ actor: name, code: errorCode }).strict()) }).strict(),
  z
    .object({
      paypalCalls: z
        .object({
          capture: z.number().int().nonnegative(),
          void: z.number().int().nonnegative(),
          reauthorize: z.number().int().nonnegative().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ui: z
        .object({
          view: z.enum(['bidder', 'auctioneer', 'public', 'audit']),
          text: z.string().optional(),
          a11y: z.literal(true).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

const bidderId = z.custom<BidderId>((v) => {
  if (typeof v !== 'string') return false;
  try {
    parseId<'BidderId'>(v);
    return true;
  } catch {
    return false;
  }
}, 'bidderId must be a ULID');

export const ScenarioSchema = z
  .object({
    id: z.string().regex(/^S\d{2}-[a-z0-9-]+$/, 'id must look like S04-duplicate-webhooks'),
    title: name,
    modes: z.array(z.enum(['inproc', 'stack'])).min(1),
    seed: z.number().int(),
    clock: z.object({ startMs: epochMs }).strict(),
    auction: z
      .object({
        itemId: name,
        reserve: cents,
        minIncrement: cents,
        softCloseMs: ms,
        mode: z.literal('english'),
      })
      .strict(),
    actors: z.record(name, z.object({ bidderId: bidderId.optional(), funding }).strict()),
    steps: z.array(StepSchema),
    expect: z.array(ExpectSchema),
    tags: z.array(name).optional(),
  })
  .strict();

/** Compile-time check that the schema output matches the published Scenario type. */
export type ParsedScenario = z.infer<typeof ScenarioSchema>;
export const toScenario = (s: ParsedScenario): Scenario => s;
