import type { SettlementState } from '../types.js';

/**
 * The engine commands the settlement bridge sends. Each is the body of an engine
 * command; the engine adapter adds `commandId`, `at` and `auctionId`. Kept
 * structural so the bridge does not import the engine's runtime code.
 */
export type BridgeCommand =
  | { type: 'RevokeCeiling'; bidderId: string; reason: 'declined' | 'expired' | 'voided' }
  | { type: 'PromoteRunnerUp'; lotId: string; disqualifiedBidderId: string; reason: string }
  | {
      type: 'RecordSettlement';
      lotId: string;
      from: SettlementState;
      to: SettlementState;
      ref: string;
    }
  | { type: 'CompleteLot'; lotId: string; capturedCents: number; ref: string }
  | { type: 'CloseAuction' };

/** What the bridge reads about one lot from the engine. */
export interface BridgeLot {
  lotId: string;
  /** The engine's lot status: OPEN, CLOSING, SETTLING or DONE, among others. */
  status: string;
  winnerId: string | null;
  priceCents: number | null;
  /** The last settlement state the engine recorded for the lot. */
  settlement: SettlementState;
}

/** The engine as the bridge sees it. */
export interface BridgeEngine {
  /** Sends one command to the auction `auctionId`. Rejects with the engine's error. */
  dispatch(auctionId: string, cmd: BridgeCommand): Promise<void>;
  lots(auctionId: string): Promise<BridgeLot[]>;
  /** The `ref` of every SETTLEMENT_STATE entry already recorded for the lot. */
  settlementRefs(auctionId: string, lotId: string): Promise<string[]>;
}
