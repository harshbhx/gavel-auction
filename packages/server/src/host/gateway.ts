import {
  ERROR_TABLE,
  decodeClientMsg,
  encodeMsg,
  type AuctionId,
  type BidderId,
  type Clock,
  type ConnId,
  type ErrorCode,
  type Ids,
  type JoinMsg,
  type RoomStore,
} from '@gavel/shared';
import { auctioneerTokenLive } from '../auth/auctioneer-floor';
import { verifyRotating, type SecretSet } from '../auth/rotation';
import type { JtiStore } from '../auth/token';
import type { RateLimiter } from '../limits/rate-limiter';
import type { Connection, Room } from '../room/room';
import type { AuctionService } from '../runtime/auction-service';
import type { BoundedConnection } from '../transport/connections';
import type { SocketHandlers } from './node-ws';

export interface GatewayDeps {
  service: Pick<AuctionService, 'room'>;
  store: Pick<RoomStore, 'lastSeq' | 'isDenied' | 'getJournal' | 'putJournal'>;
  clock: Clock;
  ids: Ids;
  secrets: SecretSet;
  limiter: Pick<RateLimiter, 'checkFrame'>;
}

const TOKEN_KINDS = ['session', 'auctioneer', 'screen'] as const;

/**
 * Turns an accepted socket into a room connection. The first frame must be a join whose token
 * verifies for that auction; later frames are decoded with the shared caps and handed to the
 * room in arrival order. Every frame, joined or not, takes a token from the connection's frame
 * bucket (R-RT-120).
 */
export function createGateway(deps: GatewayDeps): (transport: BoundedConnection) => SocketHandlers {
  const jtis: JtiStore = {
    isRevoked: (jti) => deps.store.isDenied(jti as Parameters<RoomStore['isDenied']>[0]),
    consume: () => Promise.resolve(true),
  };

  return (transport) => {
    const connId = deps.ids.mint<'ConnId'>() as ConnId;
    let attached: { room: Room; conn: Connection } | undefined;
    let chain: Promise<void> = Promise.resolve();

    const fail = (code: ErrorCode): void => {
      const out = encodeMsg({ v: 1, t: 'error', code, message: code });
      if (out.ok) transport.send(out.value);
      transport.close(ERROR_TABLE[code].closeCode ?? 1008, code);
    };

    const onJoin = (msg: JoinMsg): Promise<void> => {
      chain = chain
        .then(async () => {
          const r = await verifyRotating(msg.token, deps.secrets, {
            aud: msg.auctionId,
            kinds: TOKEN_KINDS,
            nowMs: deps.clock.now(),
            jtis,
          });
          if (!r.ok || !(await auctioneerTokenLive(deps.store, r.payload)))
            return fail('unauthorized');
          if ((await deps.store.lastSeq(msg.auctionId as AuctionId)) === 0)
            return fail('not_found');
          const room = await deps.service.room(msg.auctionId as AuctionId);
          const p = r.payload;
          const role = p.kind === 'session' ? 'bidder' : p.kind === 'invite' ? undefined : p.kind;
          if (role === undefined) return fail('unauthorized');
          const conn: Connection = {
            id: connId,
            role,
            sub: p.sub,
            transport,
            ...(p.bidderId !== undefined ? { bidderId: p.bidderId as BidderId } : {}),
          };
          if (transport.isClosed) return;
          attached = { room, conn };
          await room.attach(conn, msg.lastSeq);
        })
        .catch(() => fail('internal'));
      return chain;
    };

    const onFrame = (raw: string): Promise<void> => {
      chain = chain
        .then(async () => {
          const at = attached;
          if (!at) return;
          const decoded = decodeClientMsg(raw);
          if (!decoded.ok || decoded.value.t === 'join') return fail('bad_message');
          if (decoded.value.t === 'bid') await at.room.submitBid(at.conn, decoded.value);
          else await at.room.respondConfirm(at.conn, decoded.value);
        })
        .catch(() => fail('internal'));
      return chain;
    };

    return {
      onJoin,
      onFrame,
      admit: () => deps.limiter.checkFrame(connId).ok,
      onClosed: () => attached?.room.detach(connId),
    };
  };
}
