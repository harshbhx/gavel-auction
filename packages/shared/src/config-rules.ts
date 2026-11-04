import { AuctionConfigSchema, endsInFuture, type AuctionConfig } from './config-schema';

export type ConfigRuleResult =
  | { ok: true; config: AuctionConfig }
  | { ok: false; errors: string[] };

/** Render an issue path such as `['ceilingPresets', 2]` as `ceilingPresets[2]`. */
export function formatPath(path: readonly (string | number)[]): string {
  let out = '';
  for (const seg of path) {
    out += typeof seg === 'number' ? `[${seg}]` : out === '' ? seg : `.${seg}`;
  }
  return out === '' ? 'config' : out;
}

/**
 * Check an AuctionConfig against every boundary rule (R-RT-012). `nowMs` comes
 * from the injected clock; `endTs` must be strictly after it. All problems are
 * reported, each as `path: message`.
 */
export function checkAuctionConfig(input: unknown, nowMs: number): ConfigRuleResult {
  const parsed = AuctionConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`),
    };
  }
  if (!endsInFuture(parsed.data, nowMs)) {
    return { ok: false, errors: ['endTs: must be in the future'] };
  }
  return { ok: true, config: parsed.data };
}
