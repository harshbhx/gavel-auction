export const ERROR_CODES = [
  'bad_message',
  'unsupported_version',
  'not_joined',
  'unauthorized',
  'forbidden',
  'invite_used',
  'rate_limited',
  'room_full',
  'auction_full',
  'room_cap',
  'unregistered',
  'below_increment',
  'over_ceiling',
  'below_reserve',
  'closed',
  'already_leading',
  'bad_amount',
  'auction_paused',
  'store_unavailable',
  'conflict',
  'host_fenced',
  'not_found',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorInfo {
  readonly status: number;
  /** WebSocket close code, or null when the error does not close the socket. */
  readonly closeCode: number | null;
  readonly retryable: boolean;
}

export const ERROR_TABLE: Readonly<Record<ErrorCode, ErrorInfo>> = {
  bad_message: { status: 400, closeCode: 1008, retryable: false },
  unsupported_version: { status: 400, closeCode: 4002, retryable: false },
  not_joined: { status: 400, closeCode: 4003, retryable: false },
  unauthorized: { status: 401, closeCode: 4401, retryable: false },
  forbidden: { status: 403, closeCode: null, retryable: false },
  invite_used: { status: 409, closeCode: null, retryable: false },
  rate_limited: { status: 429, closeCode: null, retryable: true },
  room_full: { status: 503, closeCode: 4009, retryable: true },
  auction_full: { status: 503, closeCode: 4009, retryable: false },
  room_cap: { status: 503, closeCode: 4009, retryable: false },
  unregistered: { status: 403, closeCode: null, retryable: false },
  below_increment: { status: 422, closeCode: null, retryable: false },
  over_ceiling: { status: 422, closeCode: null, retryable: false },
  below_reserve: { status: 422, closeCode: null, retryable: false },
  closed: { status: 409, closeCode: null, retryable: false },
  already_leading: { status: 409, closeCode: null, retryable: false },
  bad_amount: { status: 400, closeCode: null, retryable: false },
  auction_paused: { status: 409, closeCode: null, retryable: true },
  store_unavailable: { status: 503, closeCode: null, retryable: true },
  conflict: { status: 409, closeCode: 4010, retryable: false },
  host_fenced: { status: 409, closeCode: 4010, retryable: false },
  not_found: { status: 404, closeCode: null, retryable: false },
  internal: { status: 500, closeCode: 1011, retryable: false },
};

export class GavelError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'GavelError';
    this.code = code;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_TABLE, value);
}
