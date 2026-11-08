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
      const known = isErrorCode(code) ? code : 'internal';
      if (known === 'conflict' || known === 'bad_message') {
        const { snapshot } = await snapshotFor(c.deps, room, 'auctioneer', who.sub);
        throw new GavelError(known, controlReason(known, body, snapshot));
      }
      throw new GavelError(known, 'control refused');
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

/**
 * Why the room refused a control, in words the console can show. The room only says `conflict`
 * or `bad_message`; the lot's own state tells which rule was hit.
 */
export function controlReason(
  code: 'conflict' | 'bad_message',
  body: { controlId: string; action: string; args?: Record<string, number> | undefined },
  snapshot: Pick<RoomSnapshot, 'status' | 'paused' | 'stopped' | 'hammer'>,
): string {
  const ended = snapshot.status === 'DONE' || snapshot.hammer !== undefined || snapshot.stopped;
  if (code === 'bad_message') {
    if (body.action === 'extend') return 'extraMs must be a whole number from 1 to 600000';
    return 'That control is not valid';
  }
  if (ended) return 'The lot has already ended';
  if (snapshot.status !== 'OPEN' && snapshot.status !== 'PAUSED') {
    return `The lot is not open (${snapshot.status.toLowerCase()})`;
  }
  const paused = snapshot.paused === true || snapshot.status === 'PAUSED';
  switch (body.action) {
    case 'pause':
      if (paused) return 'The lot is already paused';
      break;
    case 'resume':
      if (!paused) return 'The lot is not paused';
      break;
    case 'open':
      return 'The lot is already open';
    case 'extend':
      if (paused) return 'Resume the lot before extending it';
      break;
    case 'hammer':
      if (paused) return 'Resume the lot before the hammer';
      if (body.args?.closeNow !== 1)
        return 'The lot is still open: send closeNow 1 to close it now';
      break;
  }
  return 'That controlId was already used for a different action';
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
