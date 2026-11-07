import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, securityHeaders } from '../src/http/security-headers';

describe('securityHeaders (T-QA-076)', () => {
  it('sets CSP, HSTS, nosniff and referrer policy', () => {
    const h = securityHeaders(new Headers());
    expect(h.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(h.get('strict-transport-security')).toMatch(/max-age=\d+/);
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('no-referrer');
    expect(h.get('permissions-policy')).toContain('microphone=()');
  });

  it('replaces a weaker value already present', () => {
    const h = securityHeaders(new Headers({ 'x-content-type-options': 'other' }));
    expect(h.get('x-content-type-options')).toBe(SECURITY_HEADERS['x-content-type-options']);
  });
});
