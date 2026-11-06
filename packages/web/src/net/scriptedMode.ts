/** Scripted mode: a local scenario stands in for the server. Only an explicit flag turns it on. */
export interface ScriptedRequest {
  /** Scenario name; `happy` unless the address names another. */
  readonly name: string;
  /** Scenario time in ms to jump to and hold at. Null plays the scenario from the start. */
  readonly at: number | null;
}

export const DEFAULT_SCENARIO = 'happy';

/**
 * Reads the address query. `?scripted=1` or `?transport=scenario` turn it on; `scenario=<name>`
 * picks the script and `at=<ms>` holds it at one moment. Anything else, and every production
 * build, leaves the real connection.
 */
export function readScriptedRequest(
  search: string,
  /** Development and test builds only: a production build never honours the flag. */
  allowed: boolean = import.meta.env.DEV,
): ScriptedRequest | null {
  if (!allowed) return null;
  const params = new URLSearchParams(search);
  const on = params.get('scripted') === '1' || params.get('transport') === 'scenario';
  if (!on) return null;
  const name = params.get('scenario');
  const rawAt = params.get('at');
  const at = rawAt !== null && /^\d{1,9}$/.test(rawAt) ? Number(rawAt) : null;
  return { name: name === null || name === '' ? DEFAULT_SCENARIO : name, at };
}
