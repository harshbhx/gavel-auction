import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PERSISTED_VOICE_KEYS,
  PRIVACY_NOTICE,
  micInUse,
  type CaptureState,
} from '../src/privacy.js';

const readme = readFileSync(new URL('../docs/PRIVACY.md', import.meta.url), 'utf8');

describe('privacy (T-VOX-104)', () => {
  it('exports the required notice string', () => {
    expect(PRIVACY_NOTICE).toBe(
      'Audio is sent to a speech service to read bids. Do not speak personal data.',
    );
  });

  it('mic indicator is true only for running and muted', () => {
    const states: CaptureState[] = [
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
    for (const s of states) {
      if (s === 'running' || s === 'muted') {
        expect(micInUse(s), `${s} should be true`).toBe(true);
      } else {
        expect(micInUse(s), `${s} should be false`).toBe(false);
      }
    }
  });

  it('exports the persisted keys allow-list', () => {
    expect(PERSISTED_VOICE_KEYS).toContain('transcript');
    expect(PERSISTED_VOICE_KEYS).toContain('parseResult');
    expect(PERSISTED_VOICE_KEYS).toContain('confidence');
    expect(PERSISTED_VOICE_KEYS).toContain('timestampMs');
    expect(PERSISTED_VOICE_KEYS).toContain('provider');
    expect(PERSISTED_VOICE_KEYS).toContain('decision');
    expect(PERSISTED_VOICE_KEYS).toContain('confirmOutcome');
  });
});

describe('PRIVACY.md (T-VOX-108)', () => {
  it('contains the sandbox warning', () => {
    expect(readme.toLowerCase()).toContain('sandbox demo, do not speak personal data');
  });
});
