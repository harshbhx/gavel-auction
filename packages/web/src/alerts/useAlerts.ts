import { useEffect, useRef, useSyncExternalStore } from 'react';

import { roomStore, useRoom, type RoomStore } from '../store/roomStore';
import { selectMyStatus } from '../store/selectors';
import { alertEngine, type AlertEngine } from './engine';
import { alertForHammer, alertForStatus } from './rules';

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;

/** Unlocks sound on the first gesture of the page (browsers refuse audio before one). */
export function useAlertUnlock(engine: AlertEngine = alertEngine()): void {
  useEffect(() => {
    const unlock = (): void => {
      engine.unlock();
      GESTURES.forEach((g) => globalThis.removeEventListener(g, unlock));
    };
    GESTURES.forEach((g) => globalThis.addEventListener(g, unlock, { passive: true }));
    return () => GESTURES.forEach((g) => globalThis.removeEventListener(g, unlock));
  }, [engine]);
}

/** Bidder phone: vibrate and play a soft tone on outbid, win and sold. */
export function useAlerts(store: RoomStore = roomStore, engine: AlertEngine = alertEngine()): void {
  const status = useRoom(selectMyStatus, store);
  const previous = useRef(status);
  useAlertUnlock(engine);
  useEffect(() => {
    const type = alertForStatus(previous.current, status);
    previous.current = status;
    if (type !== null) engine.trigger(type);
  }, [status, engine]);
}

/** Projector: one gavel sound when the hammer arrives. Silent until the page has had a gesture. */
export function useHammerAlert(
  store: RoomStore = roomStore,
  engine: AlertEngine = alertEngine(),
): void {
  const hasHammer = useRoom((s) => s.hammer !== null, store);
  const previous = useRef(hasHammer);
  useAlertUnlock(engine);
  useEffect(() => {
    const type = alertForHammer(previous.current, hasHammer);
    previous.current = hasHammer;
    if (type !== null) engine.trigger(type);
  }, [hasHammer, engine]);
}

/** The mute state for a toggle. */
export function useAlertsMuted(engine: AlertEngine = alertEngine()): boolean {
  return useSyncExternalStore(engine.subscribe, engine.isMuted);
}
