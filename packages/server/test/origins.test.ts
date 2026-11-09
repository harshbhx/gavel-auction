import { describe, expect, it } from 'vitest';
import { allowedOriginsFor } from '../src/boot/compose';
import { parseConfig } from '../src/config';
import {
  allowedOriginsOf,
  isOriginAllowed,
  normalizeOrigin,
  parseOriginList,
} from '../src/http/origins';

const base = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'fake-secret-fake-secret-fake-0000',
  ADMIN_KEY: 'fake-admin-key-fake-admin-key',
};

describe('normalizeOrigin (#2233)', () => {
  it('trims, lowercases scheme and host, and drops a trailing slash and default port', () => {
    expect(normalizeOrigin('  HTTPS://Gavel.Example/ ')).toBe('https://gavel.example');
    expect(normalizeOrigin('https://a.example:443')).toBe('https://a.example');
    expect(normalizeOrigin('http://localhost:5173/')).toBe('http://localhost:5173');
  });

  it.each([
    ['https://a.example/app', 'path'],
    ['https://a.example/?x=1', 'query'],
    ['https://a.example#frag', 'fragment'],
    ['https://user:pw@a.example', 'credentials'],
    ['*', 'wildcard'],
    ['https://*.example', 'wildcard host'],
    ['ftp://a.example', 'scheme'],
    ['a.example', 'no scheme'],
    ['null', 'null'],
    ['', 'empty'],
  ])('rejects %s (%s)', (value) => {
    expect(() => normalizeOrigin(value)).toThrow();
  });
});

describe('parseOriginList', () => {
  it('normalises, dedupes and skips empty pieces', () => {
    expect(parseOriginList('https://A.example/, https://a.example,, http://b.example:80')).toEqual({
      origins: ['https://a.example', 'http://b.example'],
      errors: [],
    });
  });

  it('reports every bad entry', () => {
    const r = parseOriginList('https://ok.example, https://a.example/x, *');
    expect(r.origins).toEqual(['https://ok.example']);
    expect(r.errors).toHaveLength(2);
  });
});

describe('allowed origins are one list for HTTP, CORS and sockets', () => {
  it('holds CORS_ORIGINS, WEB_ORIGIN and the API origin, normalised', () => {
    const list = allowedOriginsOf({
      corsOrigins: ['https://A.example/'],
      webOrigin: 'https://web.example',
      publicUrl: 'https://api.example/base',
    });
    expect(list.sort()).toEqual([
      'https://a.example',
      'https://api.example',
      'https://web.example',
    ]);
  });

  it('the socket allow-list built at boot includes WEB_ORIGIN (#2233)', () => {
    const list = allowedOriginsFor({
      PUBLIC_URL: 'https://api.example',
      CORS_ORIGINS: ['https://a.example'],
      WEB_ORIGIN: 'https://web.example',
    });
    expect(list).toContain('https://web.example');
    expect(list).toContain('https://a.example');
    expect(list).toContain('https://api.example');
  });

  it('never allows null, empty, a foreign origin or a missing header', () => {
    const list = ['https://a.example'];
    expect(isOriginAllowed(list, 'https://a.example')).toBe(true);
    expect(isOriginAllowed(list, 'null')).toBe(false);
    expect(isOriginAllowed(list, '')).toBe(false);
    expect(isOriginAllowed(list, 'https://evil.example')).toBe(false);
    expect(isOriginAllowed(list, null)).toBe(false);
    expect(isOriginAllowed(list, undefined)).toBe(false);
    // Even a hand-built list that holds the string "null" does not allow it.
    expect(isOriginAllowed(['null'], 'null')).toBe(false);
  });
});

describe('CORS_ORIGINS config', () => {
  it('normalises a trailing slash and upper case', () => {
    const r = parseConfig({ ...base, CORS_ORIGINS: 'https://A.example/, https://b.example' });
    expect(r.ok && r.config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it.each(['*', 'https://a.example/app', 'a.example', 'ftp://a.example'])(
    'fails startup with a clear error for %s',
    (value) => {
      const r = parseConfig({ ...base, CORS_ORIGINS: value });
      expect(r.ok).toBe(false);
      const errors = r.ok ? [] : r.errors;
      expect(errors.some((e) => e.startsWith('CORS_ORIGINS:'))).toBe(true);
    },
  );
});
