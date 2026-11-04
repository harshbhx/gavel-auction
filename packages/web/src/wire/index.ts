// The single import seam for wire types (R-WEB-007). Every shape and decoder comes from
// @gavel/shared, so the web client and the server cannot drift apart.
import { serverSchemas, type ServerMsg } from '@gavel/shared';

export {
  PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  SETTLEMENT_STATES,
  AUCTION_STATUSES,
  decodeServerMsg,
  encodeMsg,
} from '@gavel/shared';
export type {
  AuctionConfig,
  AuctionStatus,
  AuditEventMsg,
  AuditPayload,
  BidAcceptedMsg,
  BidMsg,
  BidRejectedMsg,
  BidSource,
  ClientMsg as ClientMessage,
  ConfirmRequestMsg,
  ConfirmResponseMsg,
  ErrorCode,
  ErrorMsg,
  HammerMsg,
  JoinMsg,
  PriceMsg,
  RegisteredMsg,
  RoomSnapshot,
  ServerMsg as ServerMessage,
  SettlementState,
  SettlementUpdateMsg,
  StateMsg,
} from '@gavel/shared';

interface SafeParser {
  safeParse(data: unknown): { success: true; data: unknown } | { success: false };
}

const parsers: Readonly<Record<string, SafeParser>> = serverSchemas;

/**
 * Validates an already parsed value (a recorded event, for example) against the shared server
 * schemas. Returns null when it does not match. Never throws.
 */
export function parseServerMessage(raw: unknown): ServerMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = (raw as { t?: unknown }).t;
  if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(parsers, t)) return null;
  const result = parsers[t]?.safeParse(raw);
  return result?.success === true ? (result.data as ServerMsg) : null;
}
