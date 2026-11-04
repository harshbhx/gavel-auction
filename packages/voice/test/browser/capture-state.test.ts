import { describe, expect, it } from 'vitest';
import {
  DEGRADED_MESSAGE,
  fallbackActionFor,
  messageFor,
  reduce,
  type CaptureEvent,
} from '../../src/browser/capture-state.js';
import type { CaptureState } from '../../src/privacy.js';

const STATES: CaptureState[] = [
  'idle',
  'requesting',
  'denied',
  'no_device',
  'unsupported',
  'insecure_context',
  'running',
  'muted',
  'degraded',
  'error',
];

const TABLE: Array<[CaptureState, CaptureEvent, CaptureState]> = [
  ['idle', { type: 'start' }, 'requesting'],
  ['requesting', { type: 'granted' }, 'running'],
  ['requesting', { type: 'denied' }, 'denied'],
  ['requesting', { type: 'notfound' }, 'no_device'],
  ['requesting', { type: 'no_api' }, 'unsupported'],
  ['requesting', { type: 'insecure' }, 'insecure_context'],
  ['running', { type: 'mute' }, 'muted'],
  ['muted', { type: 'unmute' }, 'running'],
  ['running', { type: 'suspended' }, 'muted'],
  ['muted', { type: 'gesture' }, 'running'],
  ['running', { type: 'queue_drop' }, 'degraded'],
  ['degraded', { type: 'recovered' }, 'running'],
  ['running', { type: 'track_ended' }, 'error'],
  ['muted', { type: 'track_ended' }, 'error'],
  ['degraded', { type: 'track_ended' }, 'error'],
  ['error', { type: 'restart', attempt: 1 }, 'requesting'],
  ['error', { type: 'restart', attempt: 2 }, 'error'],
  ['running', { type: 'stop' }, 'idle'],
  ['muted', { type: 'stop' }, 'idle'],
  ['degraded', { type: 'stop' }, 'idle'],
  ['denied', { type: 'start' }, 'requesting'],
  ['no_device', { type: 'start' }, 'requesting'],
  ['unsupported', { type: 'start' }, 'unsupported'],
  ['insecure_context', { type: 'stop' }, 'insecure_context'],
  ['idle', { type: 'granted' }, 'idle'],
  ['denied', { type: 'granted' }, 'denied'],
];

describe('T-VOX-011 capture state transitions (R-VOX-009)', () => {
  it.each(TABLE)('%s + %j -> %s', (from, ev, to) => {
    expect(reduce(from, ev)).toBe(to);
  });

  it('track end -> error, one restart, second end -> error stays', () => {
    let s: CaptureState = reduce('running', { type: 'track_ended' });
    expect(s).toBe('error');
    s = reduce(s, { type: 'restart', attempt: 1 });
    expect(s).toBe('requesting');
    s = reduce(s, { type: 'granted' });
    s = reduce(s, { type: 'track_ended' });
    expect(s).toBe('error');
    expect(reduce(s, { type: 'restart', attempt: 2 })).toBe('error');
  });

  it('every state has a message and a fallback action id', () => {
    for (const s of STATES) {
      expect(messageFor(s).length).toBeGreaterThan(0);
      expect(['manual_entry', 'retry', 'open_settings']).toContain(fallbackActionFor(s));
    }
  });

  it('uses the exact spec messages', () => {
    expect(messageFor('denied')).toBe(
      'Microphone blocked. Allow it in the browser address bar or use manual entry.',
    );
    expect(messageFor('no_device')).toBe('No microphone found.');
    expect(messageFor('unsupported')).toBe('This browser cannot capture audio. Use manual entry.');
    expect(messageFor('insecure_context')).toBe('Microphone needs HTTPS.');
    expect(messageFor('degraded')).toBe(DEGRADED_MESSAGE);
    expect(messageFor('error')).toBe('Microphone stopped. Trying again.');
  });

  it('maps fallback actions', () => {
    expect(fallbackActionFor('denied')).toBe('open_settings');
    expect(fallbackActionFor('error')).toBe('retry');
    expect(fallbackActionFor('unsupported')).toBe('manual_entry');
  });
});
