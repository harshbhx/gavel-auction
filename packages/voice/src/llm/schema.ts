import { z } from 'zod';

/**
 * Structured output of the language-model parser (R-VOX-055). Strict: an unknown key, a fractional
 * amount or an out-of-range confidence makes the output invalid.
 */
export const llmOutputSchema = z
  .object({
    is_bid: z.boolean(),
    paddle: z.string().nullable(),
    amount_dollars: z.number().int().nullable(),
    currency: z.enum(['USD', 'other']).nullable(),
    alternatives: z.array(z.number().int()).max(3),
    is_correction: z.boolean(),
    negated: z.boolean(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type LlmOutput = z.infer<typeof llmOutputSchema>;

/**
 * Validates model output given as a JSON string or an already parsed value. Anything that fails
 * returns null, which the caller treats as the model being unavailable for that segment.
 */
export function parseLlmOutput(json: unknown): LlmOutput | null {
  let value: unknown = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch {
      return null;
    }
  }
  const parsed = llmOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
