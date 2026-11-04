import { EngineError, InvariantError } from '@gavel/engine';
import { BridgeError } from '@gavel/payments';

/**
 * The code to show an operator when a settlement step fails by rule, or undefined for a
 * failure that may pass on a retry (store or network trouble).
 */
export function reviewCodeOf(e: unknown): string | undefined {
  return e instanceof BridgeError || e instanceof EngineError || e instanceof InvariantError
    ? e.code
    : undefined;
}
