import { CONTROL_ACTIONS, GavelError, isErrorCode } from '@gavel/shared';
import { z } from 'zod';
import { authorize } from '../auth/authorize';
import { auctionIdOf, authenticate, json, parseBody, type Ctx, type HttpApp } from './app';
import { roomFor, withConnection } from './auctions';

const ControlBody = z
  .object({
    controlId: z.string().min(1).max(64),
    action: z.enum(CONTROL_ACTIONS),
    args: z.record(z.number()).optional(),
  })
  .strict();

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
      throw new GavelError(isErrorCode(code) ? code : 'internal', 'control refused');
    }
    const hammer = frames.find((f) => f.t === 'hammer');
    return json(200, { ok: true, controlId: body.controlId, ...(hammer ? { hammer } : {}) });
  });
}
