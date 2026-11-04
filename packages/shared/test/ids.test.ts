import { describe, expect, it } from 'vitest';
import { parseId } from '../src/ids';

const OK = '01HZX3K9Q8W2M4N6P8R0S2T4V6';

describe('parseId (T-RT-001)', () => {
  it('accepts a valid ULID', () => {
    expect(parseId(OK)).toBe(OK);
  });
  it('rejects wrong length', () => {
    expect(() => parseId(OK.slice(0, 25))).toThrow();
    expect(() => parseId(OK + '0')).toThrow();
  });
  it.each(['U', 'I', 'L', 'O'])('rejects char %s', (c) => {
    expect(() => parseId(OK.slice(0, 25) + c)).toThrow();
  });
  it('rejects lowercase', () => {
    expect(() => parseId(OK.toLowerCase())).toThrow();
  });
  it('rejects time prefix overflow', () => {
    expect(() => parseId('8' + OK.slice(1))).toThrow();
    expect(parseId('7' + OK.slice(1))).toBeTruthy();
  });
  it('rejects non-strings', () => {
    expect(() => parseId(123)).toThrow();
  });
});
