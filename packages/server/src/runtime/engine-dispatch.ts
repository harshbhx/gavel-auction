import { EngineError, parseCommand, type AuctionRuntime, type Ulid } from '@gavel/engine';
import type { EngineEnvelope } from '@gavel/payments';

const MAX_TIME_RETRIES = 3;

/** The part of the engine runtime the dispatch needs. */
export type DispatchRuntime = Pick<AuctionRuntime, 'state' | 'dispatch'>;

/**
 * Sends a bridge command to the engine runtime. The adapter fixed the command's time before
 * the command waited behind other writers (a webhook revoke, a ledger sync), and one of them
 * may have moved the ledger's clock since. The time is raised to the ledger's head at the
 * moment of sending, and the command is sent again when the head moved in between, so it is
 * never refused as a time regression.
 */
export async function dispatchAtHead(
  runtime: DispatchRuntime,
  cmd: EngineEnvelope,
  commandId: string,
): Promise<unknown> {
  const id = cmd.auctionId as unknown as Ulid;
  for (let attempt = 0; ; attempt++) {
    const head = (await runtime.state(id)).head.at;
    try {
      return await runtime.dispatch(
        parseCommand({ ...cmd, at: Math.max(cmd.at, head), commandId }),
      );
    } catch (e) {
      if (!(e instanceof EngineError) || e.code !== 'time_regression') throw e;
      if (attempt >= MAX_TIME_RETRIES) throw e;
    }
  }
}
