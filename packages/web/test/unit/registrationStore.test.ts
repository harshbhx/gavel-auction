import { describe, expect, it } from 'vitest';
import {
  clearRegistration,
  loadRegistration,
  saveRegistration,
  type StorageLike,
} from '../../src/payments/registrationStore';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const blocked: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('registration store (WEB-RT-10)', () => {
  it('stores one id per room and bidder', () => {
    const store = memory();
    saveRegistration('r1', 'b1', { clientRegistrationId: 'id-1' }, store);
    saveRegistration('r1', 'b2', { clientRegistrationId: 'id-2' }, store);
    saveRegistration('r2', 'b1', { clientRegistrationId: 'id-3' }, store);
    expect(loadRegistration('r1', 'b1', store)).toEqual({ clientRegistrationId: 'id-1' });
    expect(loadRegistration('r1', 'b2', store)).toEqual({ clientRegistrationId: 'id-2' });
    expect(loadRegistration('r2', 'b1', store)).toEqual({ clientRegistrationId: 'id-3' });
  });

  it('does not mix up ids whose parts contain the separator', () => {
    const store = memory();
    saveRegistration('a:b', 'c', { clientRegistrationId: 'one' }, store);
    saveRegistration('a', 'b:c', { clientRegistrationId: 'two' }, store);
    expect(loadRegistration('a:b', 'c', store)?.clientRegistrationId).toBe('one');
    expect(loadRegistration('a', 'b:c', store)?.clientRegistrationId).toBe('two');
  });

  it('clears one entry', () => {
    const store = memory();
    saveRegistration('r1', 'b1', { clientRegistrationId: 'id-1' }, store);
    clearRegistration('r1', 'b1', store);
    expect(loadRegistration('r1', 'b1', store)).toBeNull();
  });

  it('ignores damaged entries and works without storage', () => {
    const store = memory();
    for (const raw of ['not json', 'null', '{}', '{"clientRegistrationId":""}']) {
      store.data.set('gavel:registration:r1:b1', raw);
      expect(loadRegistration('r1', 'b1', store)).toBeNull();
    }
    expect(loadRegistration('r1', 'b1', null)).toBeNull();
    expect(loadRegistration('r1', 'b1', blocked)).toBeNull();
    expect(() =>
      saveRegistration('r1', 'b1', { clientRegistrationId: 'x' }, blocked),
    ).not.toThrow();
    expect(() => clearRegistration('r1', 'b1', blocked)).not.toThrow();
  });
});
