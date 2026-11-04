/** Minimum TOKEN_SECRET length in production, in bytes (R-RT-131). */
export const MIN_PROD_SECRET_BYTES = 32;
/** Minimum ADMIN_KEY length in production, in characters (R-RT-131). */
export const MIN_PROD_ADMIN_KEY_CHARS = 24;

export interface ProdGuardInput {
  NODE_ENV: string;
  TOKEN_SECRET: string;
  ADMIN_KEY: string;
  STORE: string;
  ALLOW_MEMORY_STORE: boolean;
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Production guards (R-RT-131). Returns one `NAME: message` line per problem,
 * and an empty list outside production or when every guard passes. Values are
 * never echoed back.
 */
export function productionGuardErrors(cfg: ProdGuardInput): string[] {
  if (cfg.NODE_ENV !== 'production') return [];
  const errors: string[] = [];
  if (byteLength(cfg.TOKEN_SECRET) < MIN_PROD_SECRET_BYTES) {
    errors.push(`TOKEN_SECRET: must be at least ${MIN_PROD_SECRET_BYTES} bytes in production`);
  }
  if (cfg.ADMIN_KEY.length < MIN_PROD_ADMIN_KEY_CHARS) {
    errors.push(`ADMIN_KEY: must be at least ${MIN_PROD_ADMIN_KEY_CHARS} characters in production`);
  }
  if (cfg.STORE === 'memory' && !cfg.ALLOW_MEMORY_STORE) {
    errors.push('STORE: memory store needs ALLOW_MEMORY_STORE=1 in production');
  }
  return errors;
}
