import type { CaptureState } from '../privacy.js';

export type FallbackActionId = 'manual_entry' | 'retry' | 'open_settings';

export type CaptureEvent =
  | { type: 'start' }
  | { type: 'granted' }
  | { type: 'denied' }
  | { type: 'notfound' }
  | { type: 'no_api' }
  | { type: 'insecure' }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'suspended' }
  | { type: 'gesture' }
  | { type: 'queue_drop' }
  | { type: 'recovered' }
  | { type: 'track_ended' }
  /** attempt is the 1-based count of automatic restarts including this one. */
  | { type: 'restart'; attempt: number }
  | { type: 'stop' };

export const MAX_AUTO_RESTARTS = 1;

export const DEGRADED_MESSAGE = 'Connection is slow, voice bids may be missed. Use manual entry.';

const MESSAGES: Record<CaptureState, string> = {
  idle: 'Microphone is off.',
  requesting: 'Waiting for microphone permission.',
  denied: 'Microphone blocked. Allow it in the browser address bar or use manual entry.',
  no_device: 'No microphone found.',
  unsupported: 'This browser cannot capture audio. Use manual entry.',
  insecure_context: 'Microphone needs HTTPS.',
  running: 'Listening.',
  muted: 'Microphone is muted.',
  degraded: DEGRADED_MESSAGE,
  error: 'Microphone stopped. Trying again.',
};

const ACTIONS: Record<CaptureState, FallbackActionId> = {
  idle: 'manual_entry',
  requesting: 'manual_entry',
  denied: 'open_settings',
  no_device: 'manual_entry',
  unsupported: 'manual_entry',
  insecure_context: 'manual_entry',
  running: 'manual_entry',
  muted: 'manual_entry',
  degraded: 'manual_entry',
  error: 'retry',
};

export function messageFor(state: CaptureState): string {
  return MESSAGES[state];
}

export function fallbackActionFor(state: CaptureState): FallbackActionId {
  return ACTIONS[state];
}

const LIVE: readonly CaptureState[] = ['running', 'muted', 'degraded'];

/** Pure transition table of section 7.1. Unlisted (state, event) pairs keep the state. */
export function reduce(state: CaptureState, event: CaptureEvent): CaptureState {
  switch (event.type) {
    case 'start':
      return state === 'idle' || state === 'denied' || state === 'no_device' || state === 'error'
        ? 'requesting'
        : state;
    case 'granted':
      return state === 'requesting' ? 'running' : state;
    case 'denied':
      return state === 'requesting' ? 'denied' : state;
    case 'notfound':
      return state === 'requesting' ? 'no_device' : state;
    case 'no_api':
      return state === 'requesting' || state === 'idle' ? 'unsupported' : state;
    case 'insecure':
      return state === 'requesting' || state === 'idle' ? 'insecure_context' : state;
    case 'mute':
    case 'suspended':
      return state === 'running' || state === 'degraded' ? 'muted' : state;
    case 'unmute':
    case 'gesture':
      return state === 'muted' ? 'running' : state;
    case 'queue_drop':
      return state === 'running' ? 'degraded' : state;
    case 'recovered':
      return state === 'degraded' ? 'running' : state;
    case 'track_ended':
      return LIVE.includes(state) ? 'error' : state;
    case 'restart':
      return state === 'error' && event.attempt <= MAX_AUTO_RESTARTS ? 'requesting' : state;
    case 'stop':
      return state === 'unsupported' || state === 'insecure_context' ? state : 'idle';
  }
}
