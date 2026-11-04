import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, makeApiError, scrubMessage } from '../src/api-error';

describe('ApiError (T-RT-009)', () => {
  it('accepts a valid error with and without detail', () => {
    expect(ApiErrorSchema.parse({ code: 'closed', message: 'auction closed' })).toEqual({
      code: 'closed',
      message: 'auction closed',
    });
    expect(ApiErrorSchema.safeParse({ code: 'closed', message: 'x', detail: 'y' }).success).toBe(
      true,
    );
  });

  it('rejects extra fields and unknown codes', () => {
    expect(ApiErrorSchema.safeParse({ code: 'closed', message: 'x', extra: 1 }).success).toBe(
      false,
    );
    expect(ApiErrorSchema.safeParse({ code: 'nope', message: 'x' }).success).toBe(false);
  });

  it('rejects messages that carry tokens', () => {
    expect(
      ApiErrorSchema.safeParse({ code: 'unauthorized', message: 'Bearer abc.def' }).success,
    ).toBe(false);
  });

  it('scrubs Bearer tokens and long token-like strings', () => {
    const long = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7';
    const out = scrubMessage(`bad header Bearer eyJhbGciOi.payload.sig and key ${long}`);
    expect(out).not.toContain('eyJhbGciOi');
    expect(out).not.toContain(long);
    expect(out).toContain('bad header');
  });

  it('removes stack trace lines', () => {
    const out = scrubMessage('boom\n    at fn (/srv/app.js:1:2)\n    at run (/srv/x.js:3:4)');
    expect(out).toBe('boom');
  });

  it('makeApiError scrubs and validates', () => {
    const err = makeApiError('internal', 'failed Bearer secret-token-value', 'a'.repeat(40));
    expect(err.message).not.toContain('secret-token-value');
    expect(err.detail).toBe('[redacted]');
    expect(ApiErrorSchema.safeParse(err).success).toBe(true);
  });
});
