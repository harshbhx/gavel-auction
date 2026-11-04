import { assertSandboxUrl } from '../src/guard.js';
import { redact, type EvidenceRecord } from './evidence.js';

/**
 * Thin recording HTTP layer for the gate scripts (SPEC 3.12, R-PAY-140).
 *
 * Independent of the production client on purpose: no retries, no error mapping,
 * no token cache. Gates observe what PayPal does and compare it with what the
 * client assumes, so they must not share the client's code. Every request goes
 * through the sandbox guard first, and every call is written as one evidence
 * record (SPEC 7.1) with secrets redacted.
 */

export interface RawResponse {
  status: number;
  headers: { forEach(cb: (value: string, key: string) => void): void };
  text(): Promise<string>;
}

export type RawFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<RawResponse>;

export interface RecordingHttpOptions {
  baseUrl: string;
  /** Allows loopback hosts. Only set by --fake runs. */
  fake: boolean;
  gate: string;
  runId: string;
  scriptVersion: string;
  /** Receives every record, already redacted. */
  record: (r: EvidenceRecord) => void;
  fetch?: RawFetch;
  now?: () => number;
  buyer?: string;
}

export interface GateRequest {
  method: 'GET' | 'POST';
  /** Path and query, starting with "/". */
  path: string;
  headers?: Record<string, string>;
  /** Object: sent as JSON. String: sent as is (for form bodies). */
  body?: unknown;
}

export interface GateResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  /** Parsed body, or undefined when it is not JSON. */
  json: unknown;
  latencyMs: number;
}

function parseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class RecordingHttp {
  private readonly doFetch: RawFetch;
  private readonly now: () => number;
  private buyer: string | undefined;
  private readonly base: string;

  constructor(private readonly opts: RecordingHttpOptions) {
    // Refuses a non-sandbox base URL before anything can be sent.
    this.base = assertSandboxUrl(opts.baseUrl, { fake: opts.fake }).origin;
    this.doFetch = opts.fetch ?? (globalThis.fetch as unknown as RawFetch);
    this.now = opts.now ?? Date.now;
    this.buyer = opts.buyer;
  }

  /** Label stored on the following records, for example "wallet". */
  setBuyer(buyer: string | undefined): void {
    this.buyer = buyer;
  }

  private emit(step: string, rest: Partial<EvidenceRecord>): void {
    const base: EvidenceRecord = {
      gate: this.opts.gate,
      runId: this.opts.runId,
      step,
      tsMs: this.now(),
      env: 'sandbox',
      scriptVersion: this.opts.scriptVersion,
    };
    if (this.buyer !== undefined) base.buyer = this.buyer;
    this.opts.record(redact({ ...base, ...rest }));
  }

  /** Sends one request and records it. Network failures are recorded with status 0 and rethrown. */
  async request(step: string, req: GateRequest): Promise<GateResponse> {
    if (!req.path.startsWith('/')) throw new Error(`path must start with "/": ${req.path}`);
    const url = `${this.base}${req.path}`;
    assertSandboxUrl(url, { fake: this.opts.fake });

    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    let body: string | undefined;
    // PayPal answers 415 to a bodyless POST, so one without a payload sends "{}".
    const payload: unknown = req.body === undefined && req.method === 'POST' ? {} : req.body;
    if (typeof payload === 'string') {
      body = payload;
    } else if (payload !== undefined) {
      body = JSON.stringify(payload);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }
    const init: Parameters<RawFetch>[1] = { method: req.method, headers };
    if (body !== undefined) init.body = body;
    const recorded: NonNullable<EvidenceRecord['request']> = {
      method: req.method,
      url,
      headers,
    };
    if (payload !== undefined) {
      recorded.body = typeof payload === 'string' ? (parseJson(payload) ?? payload) : payload;
    }

    const started = this.now();
    let raw: RawResponse;
    let text: string;
    try {
      raw = await this.doFetch(url, init);
      text = await raw.text();
    } catch (cause) {
      this.emit(step, {
        request: recorded,
        response: {
          status: 0,
          body: { error: cause instanceof Error ? cause.message : String(cause) },
          latencyMs: Math.max(0, this.now() - started),
        },
      });
      throw cause;
    }
    const latencyMs = Math.max(0, this.now() - started);
    const responseHeaders: Record<string, string> = {};
    raw.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });
    const json = parseJson(text);

    this.emit(step, {
      request: recorded,
      response: {
        status: raw.status,
        headers: responseHeaders,
        body: json === undefined ? text : json,
        latencyMs,
      },
    });
    return { status: raw.status, headers: responseHeaders, text, json, latencyMs };
  }

  /** Records an assertion with its expected and actual values. Returns pass. */
  assert(step: string, name: string, expected: unknown, actual: unknown): boolean {
    const pass = JSON.stringify(expected) === JSON.stringify(actual);
    this.emit(step, { assertion: { name, expected, actual, pass } });
    return pass;
  }

  /** Records a step with no HTTP call, for example an approval. */
  note(step: string, name: string, actual: unknown): void {
    this.emit(step, { assertion: { name, expected: 'recorded', actual, pass: true } });
  }
}

/**
 * OAuth client-credentials token, fetched with the recording layer. The returned
 * token is for use by the script only; the evidence copy is redacted.
 */
export async function fetchAccessToken(
  http: RecordingHttp,
  step: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  const res = await http.request(step, {
    method: 'POST',
    path: '/v1/oauth2/token',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const token =
    res.json !== null && typeof res.json === 'object'
      ? (res.json as Record<string, unknown>)['access_token']
      : undefined;
  if (res.status !== 200 || typeof token !== 'string' || token === '') {
    throw new Error(`token request failed with status ${res.status}`);
  }
  return token;
}
