import { describe, expect, it } from 'vitest';
import { controlReason } from '../src/http/control';

const open = { status: 'OPEN', paused: false, stopped: false, hammer: undefined } as const;

describe('controlReason (UIX-46)', () => {
  it('does not blame the controlId when an extend is refused on an open lot', () => {
    const why = controlReason('conflict', { controlId: 'x1', action: 'extend' }, open);
    expect(why).not.toContain('controlId');
    expect(why).toBe('The lot cannot be extended any further');
  });

  it('gives a plain fallback for any other refusal on a running lot', () => {
    expect(controlReason('conflict', { controlId: 'x1', action: 'pause' }, open)).toBe(
      'The lot refused that control',
    );
  });
});
