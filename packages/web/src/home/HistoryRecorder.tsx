import { useEffect } from 'react';
import { readScriptedRequest } from '../net/scriptedMode';
import { loadRegistration } from '../payments/registrationStore';
import type { RouteMatch } from '../routes';
import { roomStore } from '../store/roomStore';
import { selectors } from '../store/selectors';
import { getBidderSession, hasAuctioneerAccess } from '../store/session';
import { readHubKeys } from '../screens/hub/hubKeys';
import { recordRoom, type HistoryPatch, type HistoryResult, type HistoryRole } from './history';

/** Routes that mean "this visitor is taking part in the room", and the role each one implies. */
const ROLE_OF_ROUTE: Readonly<Record<string, 'auctioneer' | 'bidder' | 'watcher' | 'by-session'>> =
  {
    hub: 'auctioneer',
    console: 'auctioneer',
    screen: 'watcher',
    register: 'bidder',
    return: 'bidder',
    bid: 'by-session',
    receipt: 'by-session',
  };

const WRITE_DELAY_MS = 400;

/** What the live room store knows about this room, as a patch. Only fields with a value are set. */
export function summarize(roomId: string, role: HistoryRole): HistoryPatch {
  const state = roomStore.getState();
  if (state.auctionId !== roomId || state.snapshot === null) return {};
  const snap = state.snapshot;
  const hammer = state.hammer ?? snap.hammer ?? null;
  const price = hammer?.price ?? snap.price;
  const stopped = selectors.stopped(state);
  const status = selectors.auctionStatus(state);
  const over =
    hammer !== null || status === 'DONE' || status === 'SETTLING' || status === 'CLOSING';
  const mine = selectors.myStatus(state);
  let result: HistoryResult = 'open';
  if (stopped) result = 'stopped';
  else if (over) {
    result =
      role === 'bidder' && mine === 'won'
        ? 'won'
        : role === 'bidder' && mine === 'lost'
          ? 'lost'
          : 'closed';
  }
  const bidderId = state.me?.bidderId ?? getBidderSession(roomId)?.bidderId;
  const name =
    bidderId === undefined ? undefined : (loadRegistration(roomId, bidderId)?.name ?? undefined);
  const ceiling = state.me?.ceiling ?? snap.you?.ceiling ?? undefined;
  return {
    result,
    receipt: over,
    ...(snap.lotTitle === undefined ? {} : { lotTitle: snap.lotTitle }),
    ...(price === null ? {} : { lastPriceCents: price }),
    ...(state.me === null ? {} : { paddle: state.me.paddle }),
    ...(ceiling === undefined || ceiling === null || role !== 'bidder'
      ? {}
      : { holdCents: ceiling }),
    ...(name === undefined ? {} : { name }),
    ...(snap.joinCode === undefined ? {} : { code: snap.joinCode }),
  };
}

/**
 * Writes a small summary of the room this tab is in to the browser history (localStorage), so the
 * Home screen can greet the visitor next time. It never reads or stores a token; it renders nothing.
 */
export function HistoryRecorder({ match }: { match: RouteMatch }) {
  const routeId = match.route.id;
  const roomId = match.params['roomId'];
  useEffect(() => {
    const rule = ROLE_OF_ROUTE[routeId];
    if (rule === undefined || roomId === undefined || roomId === 'demo') return undefined;
    if (readScriptedRequest(window.location.search) !== null) return undefined;
    const role: HistoryRole =
      rule === 'by-session' ? (getBidderSession(roomId) === null ? 'watcher' : 'bidder') : rule;
    const save = (): void => {
      const summary = summarize(roomId, role);
      // A mistyped address must not become a "room": save only once this tab holds a key to the
      // room or the server has shown it exists.
      const holdsKey =
        role === 'auctioneer'
          ? hasAuctioneerAccess(roomId) || readHubKeys(roomId).auctioneer !== null
          : getBidderSession(roomId) !== null;
      if (!holdsKey && Object.keys(summary).length === 0) return;
      recordRoom(roomId, { role, ...summary });
    };
    save();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = roomStore.subscribe(() => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        save();
      }, WRITE_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
        save();
      }
    };
  }, [routeId, roomId]);
  return null;
}

export default HistoryRecorder;
