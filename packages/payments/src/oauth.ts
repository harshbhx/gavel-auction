import { PayPalError } from './errors.js';
import { classifyError } from './errorMap.js';
import { registerSecret } from './log.js';
import type { Transport, TransportRequest, TransportResult } from './transport.js';

/**
 * OAuth client-credentials token manager (SPEC 3.2, R-PAY-010).
 *
 * The token comes from POST /v1/oauth2/token with HTTP Basic credentials and is
 * cached in memory until `expires_in` minus a 60 s margin. Concurrent callers
 * share one in-flight refresh (single flight). A business call that answers 401
 * refreshes the token once and is replayed once; a second 401 is reported as
 * `auth_failed`. A refresh that fails is never cached, so the next call retries.
 *
 * Tokens are registered with the log redactor and are never part of an error.
 */

export const TOKEN_PATH = '/v1/oauth2/token';
export const EXPIRY_MARGIN_MS = 60_000;

export interface TokenManagerOptions {
  transport: Transport;
  /** Base URL of the API, already checked by the sandbox guard. No trailing slash needed. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Wall clock in ms. Default Date.now. */
  now?: () => number;
  /** Time before expiry at which a token counts as stale. Default 60 s. */
  marginMs?: number;
}

interface CachedToken {
  value: string;
  /** The token is used while now < staleAtMs. */
  staleAtMs: number;
}

/** A business call; the manager adds the Authorization header. */
export type AuthorizedRequest = Omit<TransportRequest, 'url'> & {
  /** Path and query starting with "/", resolved against the base URL. */
  path: string;
};

export class TokenManager {
  private readonly transport: Transport;
  private readonly baseUrl: string;
  private readonly basic: string;
  private readonly now: () => number;
  private readonly marginMs: number;
  private cached: CachedToken | undefined;
  private inflight: Promise<string> | undefined;

  constructor(opts: TokenManagerOptions) {
    this.transport = opts.transport;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`, 'utf8').toString('base64');
    this.now = opts.now ?? Date.now;
    this.marginMs = opts.marginMs ?? EXPIRY_MARGIN_MS;
    if (opts.clientSecret !== '') registerSecret(opts.clientSecret);
    if (this.basic !== '') registerSecret(this.basic);
  }

  /** A valid token: the cached one, or one fetched by a single shared request. */
  getToken(): Promise<string> {
    const c = this.cached;
    if (c !== undefined && this.now() < c.staleAtMs) return Promise.resolve(c.value);
    return this.refresh();
  }

  /** Drops the cached token; the next call fetches a new one. */
  invalidate(): void {
    this.cached = undefined;
  }

  private refresh(): Promise<string> {
    if (this.inflight !== undefined) return this.inflight;
    const p = this.fetchToken().finally(() => {
      if (this.inflight === p) this.inflight = undefined;
    });
    this.inflight = p;
    return p;
  }

  private async fetchToken(): Promise<string> {
    const res = await this.transport.send({
      method: 'POST',
      url: `${this.baseUrl}${TOKEN_PATH}`,
      op: 'token',
      headers: {
        Authorization: `Basic ${this.basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    if (res.status !== 200) {
      // Bad credentials are a configuration problem, not an expired token.
      throw classifyError(res.status, res.headers, res.text, { afterRefresh: true });
    }
    const parsed = parseTokenBody(res.text);
    if (parsed === undefined) {
      throw new PayPalError({
        kind: 'auth_failed',
        status: res.status,
        name: 'MALFORMED_TOKEN_RESPONSE',
        message: 'token response has no access_token',
        outcome: 'definite',
      });
    }
    registerSecret(parsed.token);
    this.cached = {
      value: parsed.token,
      staleAtMs: this.now() + parsed.expiresInMs - this.marginMs,
    };
    return parsed.token;
  }

  /**
   * Sends a business call with a bearer token. On 401 the token is refreshed once
   * and the call is replayed once with the same request id; a second 401 throws
   * `auth_failed`. Other responses are returned as the transport returned them.
   */
  async send(req: AuthorizedRequest): Promise<TransportResult> {
    const token = await this.beforeSend(() => this.getToken());
    const first = await this.sendWith(token, req);
    if (first.status !== 401) return first;

    const fresh = await this.beforeSend(() => this.refreshAfter(token));
    const second = await this.sendWith(fresh, req);
    if (second.status === 401) {
      throw classifyError(401, second.headers, second.text, { afterRefresh: true });
    }
    return second;
  }

  /**
   * Runs token acquisition. A failure here means the business request was never
   * sent, so an unknown outcome is rewritten as a definite `auth_unavailable`
   * (R-PAY-053): the caller must not treat the money call as possibly taken.
   */
  private async beforeSend(acquire: () => Promise<string>): Promise<string> {
    try {
      return await acquire();
    } catch (e) {
      if (!(e instanceof PayPalError) || e.outcome !== 'unknown') throw e;
      const init: ConstructorParameters<typeof PayPalError>[0] = {
        kind: 'auth_unavailable',
        status: e.status,
        name: 'AUTH_UNAVAILABLE',
        message: 'the access token could not be fetched; the request was not sent',
        outcome: 'definite',
      };
      if (e.debugId !== undefined) init.debugId = e.debugId;
      throw new PayPalError(init);
    }
  }

  /**
   * Replacement for a token that was rejected. When another caller has already
   * replaced it, that newer token is used instead of fetching a third one.
   */
  private refreshAfter(rejected: string): Promise<string> {
    const c = this.cached;
    if (c !== undefined && c.value !== rejected && this.now() < c.staleAtMs) {
      return Promise.resolve(c.value);
    }
    if (c !== undefined && c.value === rejected) this.cached = undefined;
    return this.refresh();
  }

  private sendWith(token: string, req: AuthorizedRequest): Promise<TransportResult> {
    const { path, headers, ...rest } = req;
    return this.transport.send({
      ...rest,
      url: `${this.baseUrl}${path}`,
      headers: { ...(headers ?? {}), Authorization: `Bearer ${token}` },
    });
  }
}

function parseTokenBody(text: string): { token: string; expiresInMs: number } | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const o = json as Record<string, unknown>;
  const token = o['access_token'];
  if (typeof token !== 'string' || token === '') return undefined;
  const expires = o['expires_in'];
  const seconds = typeof expires === 'number' && Number.isFinite(expires) ? expires : 0;
  return { token, expiresInMs: Math.max(0, seconds) * 1000 };
}
