import { useSyncExternalStore } from 'react';
import {
  initialRoomState,
  reduce,
  type Effect,
  type RoomEvent,
  type RoomState,
} from './roomReducer';
import type { Selector } from './selectors';

export type Listener = () => void;

/** How many recent server timestamps feed the clock offset estimate. */
const OFFSET_SAMPLES = 20;
export type EffectHandler = (effect: Effect) => void;

/**
 * Holds the state of one room at a time (R-WEB-028). Entering a different auction throws away
 * everything from the previous one, and a snapshot of another auction is ignored. It also
 * estimates the offset between the server clock and this device (R-WEB-026).
 */
export class RoomStore {
  private state: RoomState;
  private readonly listeners = new Set<Listener>();
  private readonly effectHandlers = new Set<EffectHandler>();

  private readonly offsetSamples: number[] = [];

  constructor(auctionId = '') {
    this.state = initialRoomState(auctionId);
  }

  /**
   * Milliseconds to add to Date.now() to get server time. A message is never delivered before
   * it was sent, so the largest (server ts minus local receive time) is the best estimate, the
   * sample with the least network delay. Zero until a message has been seen.
   */
  getClockOffsetMs = (): number =>
    this.offsetSamples.length === 0 ? 0 : Math.max(...this.offsetSamples);

  getState = (): RoomState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Receives the effects (such as a resync join) that the reducer asks for. */
  onEffect(handler: EffectHandler): () => void {
    this.effectHandlers.add(handler);
    return () => {
      this.effectHandlers.delete(handler);
    };
  }

  /** Switches room. Returns false when already in that room, and keeps the state in that case. */
  enter(auctionId: string): boolean {
    if (this.state.auctionId === auctionId) return false;
    this.state = initialRoomState(auctionId);
    this.offsetSamples.length = 0;
    this.emit();
    return true;
  }

  /** `receivedAt` is the local time the message arrived. Tests pass it; the app uses the default. */
  dispatch(event: RoomEvent, receivedAt: number = Date.now()): void {
    if (event.kind === 'wire') {
      const { msg } = event;
      if (
        msg.t === 'state' &&
        this.state.auctionId !== '' &&
        msg.snapshot.auctionId !== this.state.auctionId
      ) {
        return;
      }
      if ('ts' in msg) {
        this.offsetSamples.push(msg.ts - receivedAt);
        if (this.offsetSamples.length > OFFSET_SAMPLES) this.offsetSamples.shift();
      }
    }
    const { state, effects } = reduce(this.state, event);
    if (state !== this.state) {
      this.state = state;
      this.emit();
    }
    effects.forEach((effect) => this.effectHandlers.forEach((h) => h(effect)));
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const roomStore = new RoomStore();

/**
 * Reads a slice of the current room. Use the memoised selectors from selectors.ts: a selector
 * that builds a new object on every call would re-render forever.
 */
export function useRoom<T>(selector: Selector<T>, store: RoomStore = roomStore): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
