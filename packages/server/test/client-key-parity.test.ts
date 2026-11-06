import { sourceKey } from '@gavel/payments';
import { clientKey } from '@gavel/shared';
import { describe, expect, it } from 'vitest';

describe('client key', () => {
  it('is the same key for the join limiter and the webhook budget', () => {
    const inputs = [
      '203.0.113.9',
      '::ffff:203.0.113.9',
      '2001:db8:1:2:aaaa:bbbb:cccc:dddd',
      '2001:db8:1:2::1',
      '2001:DB8:1:2::1%eth0',
      '[2001:db8:1:2::7]',
      '::1',
      'fe80::1',
      'unknown',
      'not an address',
    ];
    for (const input of inputs) expect(clientKey(input), input).toBe(sourceKey(input));
  });
});
