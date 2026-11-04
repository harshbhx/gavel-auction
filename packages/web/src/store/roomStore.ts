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
export type EffectHandler = (effect: Effect) => void;

/**
 * Holds the state of one room at a time (R-WEB-028). Entering a different roomId throws away
 * everything from the previous room, and wire messages stamped with another room are ignored.
 */
export class RoomStore {
  private state: RoomState;
  private readonly listeners = new Set<Listener>();
  private readonly effectHandlers = new Set<EffectHandler>();

  constructor(roomId = '') {
    this.state = initialRoomState(roomId);
  }

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
  enter(roomId: string): boolean {
    if (this.state.roomId === roomId) return false;
    this.state = initialRoomState(roomId);
    this.emit();
    return true;
  }

  dispatch(event: RoomEvent): void {
    if (event.kind === 'wire' && event.msg.roomId !== this.state.roomId) return;
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
