import { PayPalError } from './errors.js';
import type { ErrorKind, Outcome } from './types.js';

/**
 * Error classifier (SPEC 4.3, R-PAY-017, R-PAY-018). Pure: no I/O, never throws
 * anything but a returned PayPalError, tolerant of garbage bodies.
 *
 * UNVERIFIED (G1): every PayPal issue name below other than the HTTP statuses.
 * The names come from the prototype and are assumptions. Fallback: the status
 * class alone decides (4xx definite, 5xx unknown) and the saga's mandatory truth
 * check before any fallback (R-PAY-053) makes a wrong name harmless.
 */

export type HeaderBag =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface ClassifyOptions {
  /** True when this 401 follows a token refresh and replay: reported as auth_failed. */
  afterRefresh?: boolean;
}

const MAX_MESSAGE = 200;

interface IssueRule {
  kind: ErrorKind;
}

/** 422 issue names. UNVERIFIED (G1) on every row. */
const ISSUE_RULES: Readonly<Record<string, IssueRule>> = {
  // UNVERIFIED (G1): AUTHORIZATION_VOIDED
  AUTHORIZATION_VOIDED: { kind: 'already_voided' },
  // UNVERIFIED (G1): AUTHORIZATION_ALREADY_VOIDED (assumed name)
  AUTHORIZATION_ALREADY_VOIDED: { kind: 'already_voided' },
  // UNVERIFIED (G1): AUTHORIZATION_EXPIRED (assumed name)
  AUTHORIZATION_EXPIRED: { kind: 'expired' },
  // UNVERIFIED (G1): AUTHORIZATION_ALREADY_CAPTURED
  AUTHORIZATION_ALREADY_CAPTURED: { kind: 'already_captured' },
  // UNVERIFIED (G1): INSTRUMENT_DECLINED
  INSTRUMENT_DECLINED: { kind: 'declined' },
  // UNVERIFIED (G1): DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS (assumed name)
  DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS: { kind: 'idempotency_conflict' },
};

function headerValue(headers: HeaderBag | undefined, name: string): string | undefined {
  if (headers === undefined) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const v = (headers as { get(n: string): string | null }).get(name);
    return v === null ? undefined : v;
  }
  const bag = headers as Readonly<Record<string, string | readonly string[] | undefined>>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() !== lower) continue;
    const v = bag[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

interface ParsedBody {
  name?: string;
  message?: string;
  issue?: string;
  debugId?: string;
}

function parseBody(text: string): ParsedBody {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return {};
  const o = json as Record<string, unknown>;
  const out: ParsedBody = {};
  const name = str(o['name']) ?? str(o['error']);
  if (name !== undefined) out.name = name;
  const message = str(o['message']) ?? str(o['error_description']);
  if (message !== undefined) out.message = message;
  const debugId = str(o['debug_id']);
  if (debugId !== undefined) out.debugId = debugId;
  const details = o['details'];
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d !== null && typeof d === 'object') {
        const issue = str((d as Record<string, unknown>)['issue']);
        if (issue !== undefined) {
          out.issue = issue;
          break;
        }
      }
    }
  }
  return out;
}

/** Plain, bounded text for a message: tags stripped, whitespace collapsed. */
function snippet(text: string): string {
  const flat = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_MESSAGE ? `${flat.slice(0, MAX_MESSAGE)}...` : flat;
}

function make(
  kind: ErrorKind,
  outcome: Outcome,
  status: number,
  parsed: ParsedBody,
  debugId: string | undefined,
  fallbackName: string,
  rawText: string,
): PayPalError {
  const message = snippet(parsed.message ?? rawText) || `HTTP ${status}`;
  const init: ConstructorParameters<typeof PayPalError>[0] = {
    kind,
    status,
    name: parsed.name ?? fallbackName,
    message,
    outcome,
  };
  if (parsed.issue !== undefined) init.issue = parsed.issue;
  if (debugId !== undefined) init.debugId = debugId;
  return new PayPalError(init);
}

/**
 * Maps an HTTP response to a PayPalError. Always returns an error: callers use it
 * only for responses they have decided are failures.
 */
export function classifyError(
  status: number,
  headers: HeaderBag | undefined,
  bodyText: string,
  opts: ClassifyOptions = {},
): PayPalError {
  const text = typeof bodyText === 'string' ? bodyText : '';
  const parsed = parseBody(text);
  const debugId = headerValue(headers, 'paypal-debug-id') ?? parsed.debugId;
  const build = (kind: ErrorKind, outcome: Outcome, fallbackName: string): PayPalError =>
    make(kind, outcome, status, parsed, debugId, fallbackName, text);

  if (status === 401) {
    return build(
      opts.afterRefresh === true ? 'auth_failed' : 'auth_expired',
      'definite',
      'UNAUTHORIZED',
    );
  }
  if (status === 404) return build('not_found', 'definite', 'RESOURCE_NOT_FOUND');
  if (status === 400) return build('invalid_request', 'definite', 'INVALID_REQUEST');
  if (status === 429) return build('rate_limited', 'unknown', 'RATE_LIMIT_REACHED');
  if (status >= 500) return build('server_error', 'unknown', 'INTERNAL_SERVICE_ERROR');
  if (status === 422) {
    const rule =
      (parsed.issue !== undefined ? ISSUE_RULES[parsed.issue] : undefined) ??
      (parsed.name !== undefined ? ISSUE_RULES[parsed.name] : undefined);
    if (rule !== undefined) return build(rule.kind, 'definite', 'UNPROCESSABLE_ENTITY');
    return build('rejected', 'definite', 'UNPROCESSABLE_ENTITY');
  }
  // A gateway timeout or an in-flight conflict does not prove the request had no
  // effect (R-PAY-053, R-PAY-054): the outcome stays unknown and the truth check decides.
  if (status === 408 || status === 409 || status === 425) {
    return build('rejected', 'unknown', `HTTP_${status}`);
  }
  if (status >= 400) return build('rejected', 'definite', `HTTP_${status}`);
  // Not an error status at all (1xx, 2xx, 3xx): the effect is not knowable here.
  return build('server_error', 'unknown', `UNEXPECTED_STATUS_${status}`);
}

/**
 * Network failure, timeout or reset: no response exists. For POSTs the effect is
 * unknown; for GETs it is transient and harmless, reported with the same
 * `unknown` outcome (reads never change state, SPEC 4.3).
 */
export function classifyNetworkError(cause: unknown, method: string): PayPalError {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const prefix = method.toUpperCase() === 'GET' ? 'read failed' : 'request outcome unknown';
  return new PayPalError({
    kind: 'network',
    status: 0,
    name: 'NETWORK_ERROR',
    message: raw === '' ? prefix : `${prefix}: ${snippet(raw)}`,
    outcome: 'unknown',
  });
}
