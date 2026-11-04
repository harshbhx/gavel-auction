import { z } from 'zod';
import { readFileSync } from 'node:fs';

/** G1 decision A, B or C (SPEC 7.3), or "unknown" until the gate has run. */
export const GatesResult = z
  .object({
    g1_remainder_mode: z.enum(['A', 'B', 'C', 'unknown']),
    g2_card_authorize: z.boolean(),
    g4_webhooks_verified: z.boolean(),
  })
  .strict();
export type GatesResult = z.infer<typeof GatesResult>;

export function parseGatesResult(value: unknown): GatesResult {
  return GatesResult.parse(value);
}

const raw: unknown = JSON.parse(
  readFileSync(new URL('./gates-result.json', import.meta.url), 'utf8'),
);

export const gatesResult: GatesResult = parseGatesResult(raw);

/** Guest card checkout is advertised only when G2 passed (R-PAY-037). */
export function cardEnabled(flags: GatesResult = gatesResult): boolean {
  return flags.g2_card_authorize === true;
}
