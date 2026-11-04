import { z } from 'zod';
import { canonicalJson } from '../src/types.js';

const REDACTED = '[REDACTED]';

const SECRET_KEYS = new Set([
  'authorization',
  'client_secret',
  'access_token',
  'paypal-transmission-sig',
  'password',
  'card_number',
  'number',
  'security_code',
  'cvv',
  // Personal fields of order and authorization responses (the repository is public).
  'email_address',
  'given_name',
  'surname',
  'full_name',
  'payer_id',
  'account_id',
  'business_name',
  'tax_id',
  'birth_date',
  'merchant_id',
  'app_id',
  'address_line_1',
  'address_line_2',
  'admin_area_1',
  'admin_area_2',
  'postal_code',
  'phone_number',
  'national_number',
  'refresh_token',
  'id_token',
  'token',
]);

const httpRequest = z.object({
  method: z.string().min(1),
  url: z.string().min(1),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
});

const httpResponse = z.object({
  status: z.number().int(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  latencyMs: z.number().nonnegative().optional(),
});

/** One evidence record (SPEC 7.1), one JSON object per line. */
export const EvidenceRecord = z.object({
  gate: z.string().min(1),
  runId: z.string().min(1),
  step: z.string().min(1),
  tsMs: z.number().int().nonnegative(),
  request: httpRequest.optional(),
  response: httpResponse.optional(),
  assertion: z
    .object({
      name: z.string().min(1),
      expected: z.unknown(),
      actual: z.unknown(),
      pass: z.boolean(),
    })
    .optional(),
  buyer: z.string().optional(),
  env: z.literal('sandbox'),
  scriptVersion: z.string().min(1),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

/** Objects whose plain string `name` is a person or cardholder name, not an error name. */
const PERSONAL_PARENTS: ReadonlySet<string> = new Set([
  'payment_source',
  'card',
  'paypal',
  'payer',
  'shipping',
  'billing_address',
]);

function redactValue(value: unknown, personal = false): unknown {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, personal));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (SECRET_KEYS.has(key) || (personal && key === 'name' && typeof v === 'string')) {
        out[k] = REDACTED;
      } else {
        out[k] = redactValue(v, personal || PERSONAL_PARENTS.has(key));
      }
    }
    return out;
  }
  return value;
}

/** Returns a deep copy with secret-bearing fields replaced by [REDACTED]. */
export function redact<T>(record: T): T {
  return redactResponse(redactValue(record)) as T;
}

/** Response headers that are kept as they are; every other response header is replaced. */
const RESPONSE_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
  'content-type',
  'paypal-debug-id',
  'date',
]);

/** Response body fields that carry per-response values and no evidence. */
const RESPONSE_BODY_DROP_KEYS: ReadonlySet<string> = new Set(['nonce', 'server-timing']);

function dropBodyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropBodyFields);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = RESPONSE_BODY_DROP_KEYS.has(k.toLowerCase()) ? REDACTED : dropBodyFields(v);
    }
    return out;
  }
  return value;
}

/** Applies the response header allowlist and drops nonce style body fields. */
function redactResponse(record: unknown): unknown {
  if (record === null || typeof record !== 'object') return record;
  const rec = record as Record<string, unknown>;
  const res = rec['response'];
  if (res === null || typeof res !== 'object') return record;
  const out: Record<string, unknown> = { ...(res as Record<string, unknown>) };
  const headers = out['headers'];
  if (headers !== null && typeof headers === 'object') {
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      kept[k] = RESPONSE_HEADER_ALLOWLIST.has(k.toLowerCase()) ? v : REDACTED;
    }
    out['headers'] = kept;
  }
  if ('body' in out) out['body'] = dropBodyFields(out['body']);
  return { ...rec, response: out };
}

const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;

const TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/,
  /\bBasic\s+[A-Za-z0-9+/=]{12,}/,
  /\bA21[A-Za-z0-9_-]{20,}/,
  /\bEE[A-Za-z0-9_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\b[A-Za-z0-9_-]{40,}\b/,
];

/** The shape of buildRequestId output: an idempotency key, not a credential. */
const REQUEST_ID_SHAPE = /\bgv1-[A-Z2-7]{40}\b/g;

/** PayPal error and issue names, for example AUTHORIZATION_NOT_HONORED_AFTER_HONOR_PERIOD. */
const ISSUE_NAME_SHAPE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** Returns the JSON paths of string values that look like credentials. */
export function lintTokens(record: unknown): string[] {
  const hits: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (value === REDACTED) return;
      const text = value
        .replace(REQUEST_ID_SHAPE, 'request-id')
        .replace(ISSUE_NAME_SHAPE, 'issue-name');
      if (TOKEN_PATTERNS.some((p) => p.test(text)) || EMAIL_SHAPE.test(text)) hits.push(path);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path === '' ? k : `${path}.${k}`);
      }
    }
  };
  walk(record, '');
  return hits;
}

/** Redacts, validates and serialises a record as one canonical JSON line. */
export function toJsonlLine(record: EvidenceRecord): string {
  const clean = redact(EvidenceRecord.parse(record));
  const hits = lintTokens(clean);
  if (hits.length > 0) throw new Error(`token-shaped value at ${hits.join(', ')}`);
  return canonicalJson(clean);
}

export interface JsonlCheck {
  line: number;
  errors: string[];
}

/** Validates a whole jsonl file: schema per line plus the token lint. */
export function lintJsonl(text: string): JsonlCheck[] {
  const problems: JsonlCheck[] = [];
  text.split('\n').forEach((raw, i) => {
    if (raw.trim() === '') return;
    const errors: string[] = [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      problems.push({ line: i + 1, errors: ['invalid json'] });
      return;
    }
    const r = EvidenceRecord.safeParse(parsed);
    if (!r.success) errors.push(...r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`));
    for (const hit of lintTokens(parsed)) errors.push(`token-shaped value at ${hit}`);
    if (errors.length > 0) problems.push({ line: i + 1, errors });
  });
  return problems;
}
