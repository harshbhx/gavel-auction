/** Codes carried by EngineError for failed command preconditions. */
export const ENGINE_ERROR_CODES = [
  'auction_closed',
  'auction_open_lots',
  'bad_amount',
  'bad_ceiling',
  'bad_command',
  'bad_id',
  'bad_time',
  'cannot_hammer',
  'cannot_lower_ceiling',
  'cannot_promote',
  'command_conflict',
  'limit_exceeded',
  'lot_done',
  'lot_frozen',
  'lot_in_progress',
  'lot_not_open',
  'non_canonical',
  'not_current_winner',
  'soft_close_not_allowed_sealed',
  'store_conflict',
  'time_regression',
  'unknown_entry_type',
  'unsupported_currency',
  'unsupported_version',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  constructor(code: EngineErrorCode, message = '') {
    super(message === '' ? code : `${code}: ${message}`);
    this.name = 'EngineError';
    this.code = code;
  }
}

/** A broken internal invariant; nothing is appended when this is thrown. */
export class InvariantError extends Error {
  readonly code: string;
  constructor(code: string, message = '') {
    super(message === '' ? code : `${code}: ${message}`);
    this.name = 'InvariantError';
    this.code = code;
  }
}
