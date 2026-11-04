import { describe, expect, it } from 'vitest';
import { defaultLeaseOwner } from '../../src/saga/owner.js';

describe('R4-S07 default lease owner', () => {
  it('is not a shared literal and is stable inside one process', () => {
    expect(defaultLeaseOwner('runner')).not.toBe('runner');
    expect(defaultLeaseOwner('admin')).not.toBe('admin');
    expect(defaultLeaseOwner('runner')).toBe(defaultLeaseOwner('runner'));
    expect(defaultLeaseOwner('runner')).not.toBe(defaultLeaseOwner('admin'));
  });
});
