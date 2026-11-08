import { CONTROL_ACTIONS, GavelError, isErrorCode, type RoomSnapshot } from '@gavel/shared';
import { z } from 'zod';
import { authorize } from '../auth/authorize';
import {
  auctionIdOf,
  authenticate,
  HttpError,
  json,
  parseBody,
  type Ctx,
  type HttpApp,
} from './app';
import { roomFor, snapshotFor, withConnection } from './auctions';

const ControlBody = z
  .object({
    controlId: z.string().min(1).max(64),
    action: z.enum(CONTROL_ACTIONS),
    args: z.record(z.number()).optional(),
  })
  .strict();

const KillBody = z
  .object({
    controlId: z.string().min(1).max(64).optional(),
    confirm: z.literal('STOP'),
  })
  .strict();

/** Reasons a hammer is refused because the lot head moved; carried as the 409 message. */
const STALE_HAMMER = new Set(['price_changed', 'leader_changed']);

/**
 * `POST /api/auctions/:id/control` (R-RT-106). The route only maps the request onto
 * `Room.control`; idempotency by `controlId`, audit and the hammer itself stay in the room.
 */
export function mountControl(app: HttpApp): void {
  app.post('/api/auctions/:id/control', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const who = await authenticate(c, auctionId, ['auctioneer', 'session', 'screen']);
    const role = who.kind === 'auctioneer' ? 'auctioneer' : 'bidder';
    if (!authorize('control', role).ok) throw new GavelError('forbidden', 'not allowed');
    const body = parseBody(ControlBody, await c.body());
    const room = await roomFor(c.deps, auctionId);
    const frames = await withConnection(c.deps, room, 'auctioneer', who.sub, (conn) =>
      room.control(conn, {
        controlId: body.controlId,
        action: body.action,
        ...(body.args !== undefined ? { args: body.args } : {}),
      }),
    );
    const failure = frames.find((f) => f.t === 'error');
    if (failure !== undefined) {
      const code = failure.code;
      const why = failure.message;
      if (code === 'conflict' && typeof why === 'string' && STALE_HAMMER.has(why)) {
        throw new HttpError(409, 'conflict', why, why);
      }
      throw new GavelError(isErrorCode(code) ? code : 'internal', 'control refused');
    }
    const hammer = frames.find((f) => f.t === 'hammer');
    return json(200, { ok: true, controlId: body.controlId, ...(hammer ? { hammer } : {}) });
  });

  /**
   * `POST /api/auctions/:id/kill`: the console Stop button. Ends the lot as an unsold hammer so
   * settlement voids every hold. Same auth as `control`; a repeat (or a lot that is already over)
   * is a no-op that answers 200 with the current state.
   */
  app.post('/api/auctions/:id/kill', async (c: Ctx) => {
    const auctionId = auctionIdOf(c);
    const who = await authenticate(c, auctionId, ['auctioneer', 'session', 'screen']);
    const role = who.kind === 'auctioneer' ? 'auctioneer' : 'bidder';
    if (!authorize('control', role).ok) throw new GavelError('forbidden', 'not allowed');
    const body = parseBody(KillBody, await c.body());
    const room = await roomFor(c.deps, auctionId);
    await room.abort(who.sub);
    const { snapshot } = await snapshotFor(c.deps, room, 'auctioneer', who.sub);
    return json(200, {
      ok: true,
      ...(body.controlId ? { controlId: body.controlId } : {}),
      state: stateOf(snapshot),
    });
  });
}

function stateOf(s: RoomSnapshot): {
  status: RoomSnapshot['status'];
  stopped: boolean;
  registrationClosed: boolean;
} {
  return {
    status: s.status,
    stopped: s.stopped === true,
    registrationClosed: s.registrationClosed === true,
  };
}
