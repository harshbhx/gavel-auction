import { z } from 'zod';
import { isCents, type Cents } from './money';
import { EpochMs } from './time';

const cents = z
  .number()
  .refine(isCents, 'must be integer cents in range')
  .transform((n) => n as Cents);

const epochMs = z
  .number()
  .int()
  .transform((n) => EpochMs(n));

const durationMs = z.number().int().nonnegative();

export const HOLD_SCOPES = ['event', 'lot'] as const;

export const AUCTION_MODES = ['english', 'proxy', 'second_price'] as const;

/** Boundary limits (R-RT-012). */
export const MIN_RESERVE_CENTS = 100;
export const MIN_INCREMENT_CENTS = 1;
export const MAX_SOFT_CLOSE_EXTENSION_MS = 600_000;
export const MAX_EXTENSIONS_LIMIT = 50;
export const MAX_CEILING_PRESETS = 8;
export const MAX_INCREMENT_TIERS = 16;

/** Per-auction settings shared by server and web. */
export const AuctionConfigSchema = z
  .object({
    mode: z.enum(AUCTION_MODES).default('english'),
    currency: z.literal('USD'),
    reserve: cents.refine((c) => c >= MIN_RESERVE_CENTS, 'reserve must be at least 100 cents'),
    minIncrement: cents.refine((c) => c >= MIN_INCREMENT_CENTS, 'minIncrement must be positive'),
    endTs: epochMs,
    softCloseWindowMs: durationMs,
    softCloseExtensionMs: durationMs.max(MAX_SOFT_CLOSE_EXTENSION_MS),
    maxExtensions: z.number().int().nonnegative().max(MAX_EXTENSIONS_LIMIT),
    ceilingPresets: z.array(cents).min(1).max(MAX_CEILING_PRESETS),
    confirmConfidenceThreshold: z.number().min(0).max(1),
    autoHammerDelayMs: durationMs.optional(),
    /** Whether one hold covers the whole event or a single lot; the engine default is event. */
    holdScope: z.enum(HOLD_SCOPES).optional(),
    /** Tiered increments; when set it replaces the flat minIncrement above the first tier. */
    incrementLadder: z
      .array(z.object({ fromCents: cents, incrementCents: cents }).strict())
      .min(1)
      .max(MAX_INCREMENT_TIERS)
      .optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const ladder = cfg.incrementLadder ?? [];
    for (let i = 0; i < ladder.length; i++) {
      const tier = ladder[i];
      const prev = i > 0 ? ladder[i - 1] : undefined;
      if (tier === undefined) continue;
      if (
        (i === 0 && tier.fromCents !== 0) ||
        (prev !== undefined && tier.fromCents <= prev.fromCents)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['incrementLadder', i, 'fromCents'],
          message: 'incrementLadder must start at 0 and strictly ascend',
        });
      }
      if (tier.incrementCents < MIN_INCREMENT_CENTS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['incrementLadder', i, 'incrementCents'],
          message: 'incrementCents must be positive',
        });
      }
    }
    const presets = cfg.ceilingPresets;
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i] ?? 0;
      const prev = i > 0 ? (presets[i - 1] ?? 0) : -1;
      if (p <= prev) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ceilingPresets', i],
          message: 'ceilingPresets must be strictly ascending',
        });
      }
      if (p < cfg.reserve) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ceilingPresets', i],
          message: 'ceilingPresets must not be below the reserve',
        });
      }
    }
  });

export type AuctionConfig = z.infer<typeof AuctionConfigSchema>;

/** True when the auction ends strictly after `nowMs`; creation routes must check it. */
export function endsInFuture(cfg: Pick<AuctionConfig, 'endTs'>, nowMs: number): boolean {
  return cfg.endTs > nowMs;
}
