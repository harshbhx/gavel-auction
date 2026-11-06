import {
  ApproveHoldRequest,
  CreateHoldRequest,
  GavelError,
  HOLD_ERROR_STATUS,
  holdOwnedBySession,
  type AbandonHoldResponse,
  type HoldErrorCode,
  type HoldViewResponse,
} from '@gavel/shared';
import { HoldError, toHoldError, type HoldService, type HoldStore } from '@gavel/payments';
import { authenticate, json, parseBody, type Ctx, type HttpApp, type Mount } from './app';
import { roomFor, snapshotFor } from './auctions';

/** What the hold routes call: the payments hold service and its store. Both exist already. */
export interface HoldsPort {
  service: Pick<HoldService, 'createHoldOrder' | 'completeApproval' | 'abandonHold'>;
  store: Pick<HoldStore, 'get'>;
  /**
   * True while the auction may still take holds: not hammered and no settlement yet. A new
   * order or an approval after that is refused, so no authorization appears that the cut
   * settlement plan does not know (`AuctionService.acceptsHolds`).
   */
  acceptsHolds: (auctionId: string) => Promise<boolean>;
  /**
   * Puts the session bidder in the room once their hold is authorized. Idempotent: a second
   * call for the same hold changes nothing. Called by the approve route when the body names
   * the bidder.
   */
  registerBidder?: (input: {
    auctionId: string;
    bidderId: string;
    holdId: string;
    name: string;
  }) => Promise<void>;
}

function holdFailure(code: HoldErrorCode, message: string): Response {
  return json(HOLD_ERROR_STATUS[code], { error: code, message });
}

/** A guessed id and somebody else's id look the same to the caller (R-PAY-035). */
function notFound(): Response {
  return holdFailure('order_not_found', 'no such hold');
}

async function requireOpen(port: HoldsPort, auctionId: string): Promise<void> {
  if (!(await port.acceptsHolds(auctionId))) {
    throw new GavelError('closed', 'the auction no longer takes holds');
  }
}

async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HoldError) return holdFailure(e.code, e.message);
    // Anything that is not a payments error is mapped or rethrown to the host error handler.
    const mapped = (() => {
      try {
        return toHoldError(e);
      } catch {
        return null;
      }
    })();
    if (mapped === null) throw e;
    return holdFailure(mapped.code, mapped.message);
  }
}

/**
 * Hold routes for the web approval flow. The bidder is always the one named by the session
 * token, never by the request body (R-PAY-030).
 *
 *   POST /api/holds                    create the hold order
 *   POST /api/holds/:holdId/approve    authorize the approved order
 *   GET  /api/holds/:holdId            read the hold of this session
 *   DELETE /api/holds/:holdId          abandon an unapproved hold (idempotent)
 */
export function mountHolds(port: HoldsPort): Mount {
  return (app: HttpApp): void => {
    app.post('/api/holds', (c: Ctx) =>
      guarded(async () => {
        const body = parseBody(CreateHoldRequest, await c.body());
        const who = await authenticate(c, body.auctionId, ['session']);
        if (who.bidderId === undefined) return notFound();
        const room = await roomFor(c.deps, body.auctionId);
        await requireOpen(port, body.auctionId);
        const { snapshot } = await snapshotFor(c.deps, room, 'screen', 'holds');
        const created = await port.service.createHoldOrder({
          auctionId: body.auctionId,
          bidderId: who.bidderId,
          ceilingCents: body.ceilingCents,
          presetsCents: snapshot.config.ceilingPresets,
        });
        return json(201, { holdId: created.holdId, orderId: created.orderId });
      }),
    );

    app.post('/api/holds/:holdId/approve', (c: Ctx) =>
      guarded(async () => {
        const holdId = c.params.holdId ?? '';
        const body = parseBody(ApproveHoldRequest, await c.body());
        const hold = await port.store.get(holdId);
        if (hold === null) return notFound();
        const who = await authenticate(c, hold.auctionId, ['session']);
        if (!holdOwnedBySession(hold.bidderId, who.bidderId)) return notFound();
        await requireOpen(port, hold.auctionId);
        const approved = await port.service.completeApproval({ holdId, orderId: body.orderId });
        if (body.name !== undefined && port.registerBidder !== undefined) {
          await port.registerBidder({
            auctionId: hold.auctionId,
            bidderId: hold.bidderId,
            holdId,
            name: body.name,
          });
        }
        return json(200, approved);
      }),
    );

    app.get('/api/holds/:holdId', (c: Ctx) =>
      guarded(async () => {
        const holdId = c.params.holdId ?? '';
        const hold = await port.store.get(holdId);
        if (hold === null) return notFound();
        const who = await authenticate(c, hold.auctionId, ['session']);
        if (!holdOwnedBySession(hold.bidderId, who.bidderId)) return notFound();
        const view: HoldViewResponse = {
          holdId: hold.holdId,
          status: hold.status,
          ceilingCents: hold.ceilingCents,
        };
        return json(200, view);
      }),
    );

    app.route('DELETE', '/api/holds/:holdId', (c: Ctx) =>
      guarded(async () => {
        const holdId = c.params.holdId ?? '';
        const hold = await port.store.get(holdId);
        if (hold === null) return notFound();
        const who = await authenticate(c, hold.auctionId, ['session']);
        if (!holdOwnedBySession(hold.bidderId, who.bidderId)) return notFound();
        const abandoned = await port.service.abandonHold(holdId);
        if (!abandoned) {
          return holdFailure('hold_exists', 'the hold is already authorized and was not released');
        }
        const released: AbandonHoldResponse = { holdId, released: true };
        return json(200, released);
      }),
    );
  };
}
