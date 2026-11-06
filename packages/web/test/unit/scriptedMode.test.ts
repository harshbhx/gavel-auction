import { describe, expect, it } from 'vitest';
import { readScriptedRequest } from '../../src/net/scriptedMode';

describe('readScriptedRequest', () => {
  it('reads the flag when scripted mode is allowed', () => {
    expect(readScriptedRequest('?scripted=1', true)).toEqual({ name: 'happy', at: null });
    expect(readScriptedRequest('?transport=scenario&scenario=soft_close&at=500', true)).toEqual({
      name: 'soft_close',
      at: 500,
    });
  });

  it('returns null without the flag', () => {
    expect(readScriptedRequest('', true)).toBeNull();
    expect(readScriptedRequest('?scripted=0', true)).toBeNull();
  });

  it('ignores the flag in a build that does not allow it', () => {
    expect(readScriptedRequest('?scripted=1', false)).toBeNull();
    expect(readScriptedRequest('?transport=scenario', false)).toBeNull();
  });
});
