import { describe, expect, it } from 'vitest';
import { clientKey } from '../src/client-key';

describe('clientKey', () => {
  it('maps every address in one IPv6 /64 to the same key', () => {
    const a = clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:2::1')).toBe(a);
    expect(clientKey('2001:DB8:1:2:0:0:0:9%eth0')).toBe(a);
    expect(clientKey('[2001:db8:1:2::7]')).toBe(a);
    expect(clientKey('2001:db8:1:3::1')).not.toBe(a);
  });
  it('leaves IPv4 unchanged and unwraps IPv4-mapped IPv6', () => {
    expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('unknown')).toBe('unknown');
  });
});
