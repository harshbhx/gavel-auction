import type { RoomStore } from '../store/roomStore';

/** How long to wait for the answer to a resync join before sending it again. */
export const RESYNC_RETRY_MS = 3000;

export interface ResyncDeps {
  /**
   * Gets a fresh snapshot: reopens the connection so the first join carries the session token and
   * the store's current lastSeq. The gateway refuses a second join on an open socket.
   */
  requestSnapshot(): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Connects the store's resync effect to the connection. The request reopens the connection, so
 * the join carries the session token, and it is repeated until a snapshot arrives, because the
 * first one may be sent while the socket is down. Returns an unbind function.
 */
export function bindResync(store: RoomStore, deps: ResyncDeps): () => void {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as number));
  let timer: unknown = null;

  const stop = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const arm = (): void => {
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      if (!store.getState().resyncing) return;
      deps.requestSnapshot();
      arm();
    }, RESYNC_RETRY_MS);
  };

  const offEffect = store.onEffect((effect) => {
    if (effect.type !== 'resync') return;
    deps.requestSnapshot();
    arm();
  });
  const offState = store.subscribe(() => {
    if (!store.getState().resyncing) stop();
  });
  return () => {
    offEffect();
    offState();
    stop();
  };
}
