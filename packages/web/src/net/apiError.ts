import { t } from '../copy/t';

/** Why an API read failed, so a screen can tell "not found" from "slow down" and "no network". */
export type ApiFailureKind = 'notFound' | 'rateLimited' | 'unreachable' | 'other';

export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  /** Seconds to wait, from Retry-After; null when the server did not say. */
  readonly retryAfterS: number | null;
  constructor(kind: ApiFailureKind, status: number | null, retryAfterS: number | null = null) {
    super(kind);
    this.kind = kind;
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

/** Seconds from a Retry-After header: whole seconds only, bounded to a day. */
export function retryAfterSeconds(res: Pick<Response, 'headers'>): number | null {
  const raw = res.headers?.get('retry-after') ?? null;
  if (raw === null || !/^\d{1,6}$/.test(raw.trim())) return null;
  const s = Number(raw);
  return s >= 1 ? Math.min(s, 86_400) : null;
}

/** The error for a non-ok response. */
export function apiErrorFor(res: Pick<Response, 'status' | 'headers'>): ApiError {
  if (res.status === 404) return new ApiError('notFound', 404);
  if (res.status === 429) return new ApiError('rateLimited', 429, retryAfterSeconds(res));
  return new ApiError('other', res.status);
}

/** The error for a fetch that threw: the server could not be reached (or CORS blocked it). */
export function unreachable(): ApiError {
  return new ApiError('unreachable', null);
}

/** A readable wait such as "30 s", "10 min" or "1 h". Empty when unknown. */
export function waitText(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 90) return t('time.seconds', { n: seconds });
  if (seconds < 5400) return t('time.minutes', { n: Math.ceil(seconds / 60) });
  return t('time.hours', { n: Math.ceil(seconds / 3600) });
}

/** What a failed code lookup says when it was not "no such room"; null means use the usual text. */
export function lookupProblemText(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.kind === 'rateLimited') return t('join.rateTitle');
  if (error.kind === 'unreachable') return t('join.offlineTitle');
  return null;
}
