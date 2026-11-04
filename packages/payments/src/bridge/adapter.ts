import type { SettlementState } from '../types.js';
import type { BridgeCommand, BridgeEngine, BridgeLot } from './types.js';

/** A command with the envelope the engine wants; pass it through the engine's `parseCommand`. */
export type EngineEnvelope = BridgeCommand & { commandId: string; at: number; auctionId: string };

/** The part of the engine's AuctionState the bridge reads. */
export interface EngineStateView {
  head: { at: number };
  lotOrder: readonly string[];
  lots: Readonly<
    Record<
      string,
      {
        lotId: string;
        status: string;
        winnerId: string | null;
        priceCents: number | null;
        settlement: SettlementState;
      }
    >
  >;
}

export interface EngineAdapterDeps {
  /** Sends one command; the host validates it (parseCommand) and calls AuctionRuntime.dispatch. */
  dispatch(cmd: EngineEnvelope): Promise<unknown>;
  /** AuctionRuntime.state. */
  state(auctionId: string): Promise<EngineStateView>;
  /** Ledger entries from `fromSeq` (AuctionRuntime's store.read). */
  read(
    auctionId: string,
    fromSeq: number,
  ): Promise<ReadonlyArray<{ type: string; payload: unknown }>>;
  newCommandId(): string;
  nowMs(): number;
}

/**
 * Turns an engine runtime into the BridgeEngine port. Command time is the later of
 * the clock and the ledger head, so a clock that lags the last entry never trips
 * the engine's time_regression check.
 */
export function createEngineAdapter(deps: EngineAdapterDeps): BridgeEngine {
  return {
    async dispatch(auctionId, cmd) {
      const state = await deps.state(auctionId);
      await deps.dispatch({
        ...cmd,
        commandId: deps.newCommandId(),
        at: Math.max(deps.nowMs(), state.head.at),
        auctionId,
      });
    },
    async lots(auctionId): Promise<BridgeLot[]> {
      const state = await deps.state(auctionId);
      return state.lotOrder.flatMap((id) => {
        const l = state.lots[id];
        return l === undefined
          ? []
          : [
              {
                lotId: l.lotId,
                status: l.status,
                winnerId: l.winnerId,
                priceCents: l.priceCents,
                settlement: l.settlement,
              },
            ];
      });
    },
    async settlementRefs(auctionId, lotId) {
      const refs: string[] = [];
      for (const e of await deps.read(auctionId, 1)) {
        if (e.type !== 'SETTLEMENT_STATE') continue;
        const p = e.payload as { lotId?: unknown; ref?: unknown };
        if (p.lotId === lotId && typeof p.ref === 'string') refs.push(p.ref);
      }
      return refs;
    },
  };
}
