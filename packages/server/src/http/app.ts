import {
  ERROR_TABLE,
  GavelError,
  isUlid,
  makeApiError,
  type Clock,
  type ErrorCode,
  type Ids,
  type RoomStore,
} from '@gavel/shared';
import type { z } from 'zod';
import { signWithCurrent, verifyRotating, type SecretSet } from '../auth/rotation';
import { TOKEN_TTL_S, type JtiStore, type TokenKind, type TokenPayload } from '../auth/token';
import { auctioneerTokenLive } from '../auth/auctioneer-floor';
import type { AuctionService } from '../runtime/auction-service';

/** Largest request body the host reads (R-RT-105). */
export const MAX_BODY_BYTES = 64 * 1024;

/** What every route needs. The host builds it once and passes it to `createHttpApp`. */
export interface HttpDeps {
  service: Pick<AuctionService, 'createAuction' | 'room'>;
  store: RoomStore;
  clock: Clock;
  ids: Ids;
  /** Signs with the current secret, verifies with the current and previous one. */
  secrets: SecretSet;
  /** Operator key for admin routes. Compared in constant time. */
  adminKey: string;
  /** Public origin used to build links, no trailing slash. */
  publicUrl: string;
  /** Origins allowed by CORS. Anything else gets no CORS headers. */
  corsOrigins: readonly string[];
  /** Override of the WebSocket URL returned by join. Defaults to PUBLIC_URL with ws scheme and /ws. */
  wsUrl?: string;
  maxBodyBytes?: number;
  /** Per-client join limit (R-RT-120). Returns the wait in ms when the caller is over it. */
  joinLimit?: (req: Request) => { ok: true } | { ok: false; retryAfterMs: number };
}

/** An error with a status the shared table does not carry (413, 415). */
export class HttpError extends GavelError {
  constructor(
    readonly status: number,
    code: ErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(code, message);
  }
}

export interface Ctx {
  req: Request;
  url: URL;
  params: Readonly<Record<string, string>>;
  requestId: string;
  deps: HttpDeps;
  /** Parsed JSON body; undefined when the request has none. Size and type are already checked. */
  body(): Promise<unknown>;
}

export type Handler = (c: Ctx) => Promise<Response> | Response;
export type Mount = (app: HttpApp) => void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

export function json(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export class HttpApp {
  private readonly routes: Route[] = [];

  constructor(readonly deps: HttpDeps) {}

  route(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: split(pattern), handler });
  }

  get(pattern: string, handler: Handler): void {
    this.route('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): void {
    this.route('POST', pattern, handler);
  }

  /** Entry point: never throws, every response carries `x-request-id`. */
  async fetch(req: Request): Promise<Response> {
    const supplied = req.headers.get('x-request-id');
    const requestId =
      supplied !== null && REQUEST_ID_RE.test(supplied) ? supplied : this.deps.ids.mint();
    const origin = req.headers.get('origin');
    const allowed = origin !== null && this.deps.corsOrigins.includes(origin) ? origin : null;
    let res: Response;
    try {
      res = await this.dispatch(req, requestId, allowed);
    } catch (e) {
      res = errorResponse(e);
    }
    const out = new Response(res.body, res);
    out.headers.set('x-request-id', requestId);
    out.headers.set('cache-control', 'no-store');
    out.headers.set('x-content-type-options', 'nosniff');
    if (allowed !== null) {
      out.headers.set('access-control-allow-origin', allowed);
      out.headers.set('access-control-expose-headers', 'x-request-id');
      out.headers.append('vary', 'Origin');
    }
    return out;
  }

  private async dispatch(
    req: Request,
    requestId: string,
    allowedOrigin: string | null,
  ): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      if (allowedOrigin === null) throw new GavelError('forbidden', 'origin not allowed');
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type, x-request-id, x-admin-key',
          'access-control-max-age': '600',
        },
      });
    }
    const path = split(url.pathname);
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const params = match(r.segments, path);
      if (params === null) continue;
      const limit = this.deps.maxBodyBytes ?? MAX_BODY_BYTES;
      let cached: Promise<unknown> | undefined;
      const ctx: Ctx = {
        req,
        url,
        params,
        requestId,
        deps: this.deps,
        body: () => (cached ??= readJson(req, limit)),
      };
      return r.handler(ctx);
    }
    throw new GavelError('not_found', 'no such route');
  }
}

function split(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function match(pattern: string[], path: string[]): Record<string, string> | null {
  if (pattern.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i] ?? '';
    const v = path[i] ?? '';
    if (p.startsWith(':')) {
      try {
        params[p.slice(1)] = decodeURIComponent(v);
      } catch {
        return null;
      }
    } else if (p !== v) return null;
  }
  return params;
}

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return json(e.status, makeApiError(e.code, e.message, e.detail));
  }
  if (e instanceof GavelError && e.code !== 'internal') {
    return json(ERROR_TABLE[e.code].status, makeApiError(e.code, e.message));
  }
  return json(500, makeApiError('internal', 'internal error'));
}

async function readJson(req: Request, limit: number): Promise<unknown> {
  if (!BODY_METHODS.has(req.method)) return undefined;
  const declared = req.headers.get('content-length');
  if (req.body === null || declared === '0') return undefined;
  const type = (req.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (type !== 'application/json') {
    throw new HttpError(415, 'bad_message', 'content-type must be application/json');
  }
  if (declared !== null && Number(declared) > limit) {
    throw new HttpError(413, 'bad_message', 'request body too large');
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'bad_message', 'request body too large');
    }
    chunks.push(value);
  }
  if (size === 0) return undefined;
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GavelError('bad_message', 'body is not valid JSON');
  }
}

/** Build the app and run each mount against it. */
export function createHttpApp(deps: HttpDeps, mounts: readonly Mount[] = []): HttpApp {
  const app = new HttpApp(deps);
  for (const m of mounts) m(app);
  return app;
}

// ---- shared helpers for the route files -------------------------------------------------

/** Parse a body with a zod schema; failures are 400 with the field paths in `detail`. */
export function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): T {
  const r = schema.safeParse(raw ?? {});
  if (r.success) return r.data;
  const detail = r.error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
  throw new HttpError(400, 'bad_message', 'invalid request body', detail);
}

/** The `:id` route parameter as an auction id; anything else is not found. */
export function auctionIdOf(c: Ctx): string {
  const id = c.params.id;
  if (id === undefined || !isUlid(id)) throw new GavelError('not_found', 'no such auction');
  return id;
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Admin routes: the operator key in `x-admin-key`. */
export function requireAdmin(c: Ctx): void {
  const key = c.req.headers.get('x-admin-key');
  if (key === null || c.deps.adminKey.length === 0 || !constantTimeEqual(key, c.deps.adminKey)) {
    throw new GavelError('unauthorized', 'admin key required');
  }
}

export function bearerOf(c: Ctx): string {
  const h = c.req.headers.get('authorization') ?? '';
  const m = /^Bearer (\S+)$/i.exec(h);
  if (m?.[1] === undefined) throw new GavelError('unauthorized', 'bearer token required');
  return m[1];
}

/** Denylist and single-use state backed by the room store (R-RT-083, R-RT-084). */
export function jtiStoreOf(deps: HttpDeps): JtiStore {
  return {
    isRevoked: (jti) => deps.store.isDenied(jti as Parameters<RoomStore['isDenied']>[0]),
    consume: (jti, expSec) =>
      deps.store.consumeJti(
        jti as Parameters<RoomStore['consumeJti']>[0],
        Math.max(1, expSec * 1000 - deps.clock.now()),
      ),
  };
}

/** Verify a token for an auction; failures surface as the matching error code. */
export async function verifyFor(
  deps: HttpDeps,
  token: string,
  auctionId: string,
  kinds: readonly TokenKind[],
): Promise<TokenPayload> {
  const r = await verifyRotating(token, deps.secrets, {
    aud: auctionId,
    kinds,
    nowMs: deps.clock.now(),
    jtis: jtiStoreOf(deps),
  });
  if (!r.ok) throw new GavelError(r.code, r.reason);
  if (!(await auctioneerTokenLive(deps.store, r.payload))) {
    throw new GavelError('unauthorized', 'token revoked');
  }
  return r.payload;
}

/** Bearer-token check for a route. */
export function authenticate(
  c: Ctx,
  auctionId: string,
  kinds: readonly TokenKind[],
): Promise<TokenPayload> {
  return verifyFor(c.deps, bearerOf(c), auctionId, kinds);
}

export interface Minted {
  token: string;
  jti: string;
  bidderId?: string;
  /** Expiry in epoch seconds. */
  exp: number;
}

/** Sign a token with the injected secret set. No secret is read from anywhere else. */
export async function mintToken(
  deps: HttpDeps,
  kind: TokenKind,
  auctionId: string,
  sub: string,
  bidderId?: string,
  notBeforeSec = 0,
): Promise<Minted> {
  const iat = Math.max(Math.floor(deps.clock.now() / 1000), notBeforeSec);
  const jti = deps.ids.mint<'Jti'>();
  const payload: TokenPayload = {
    kind,
    aud: auctionId,
    sub,
    jti,
    iat,
    exp: iat + TOKEN_TTL_S[kind],
    ...(bidderId !== undefined ? { bidderId } : {}),
  };
  const token = await signWithCurrent(payload, deps.secrets);
  return { token, jti, exp: payload.exp, ...(bidderId !== undefined ? { bidderId } : {}) };
}
