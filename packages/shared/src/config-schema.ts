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

export const AUCTION_MODES = ['english'] as const;

/** Per-auction settings shared by server and web. Boundary rules live in a separate issue. */
export const AuctionConfigSchema = z
  .object({
    mode: z.enum(AUCTION_MODES).default('english'),
    currency: z.literal('USD'),
    reserve: cents,
    minIncrement: cents,
    endTs: epochMs,
    softCloseWindowMs: durationMs,
    softCloseExtensionMs: durationMs,
    maxExtensions: z.number().int().nonnegative(),
    ceilingPresets: z.array(cents),
    confirmConfidenceThreshold: z.number().min(0).max(1),
    autoHammerDelayMs: durationMs.optional(),
  })
  .strict();

export type AuctionConfig = z.infer<typeof AuctionConfigSchema>;
