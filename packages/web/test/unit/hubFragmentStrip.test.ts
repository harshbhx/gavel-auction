// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetHubRoom, readHubKeys, stripHubFragment } from '../../src/screens/hub/hubKeys';

const ROOM = 'room-strip';

describe('hub strips its keys from the address bar after reading (#2434)', () => {
  beforeEach(() => {
    forgetHubRoom(ROOM);
    window.history.replaceState(null, '', '/');
  });

  it('keeps the keys in sessionStorage, empties the fragment, and a reload still reads them', () => {
    window.history.replaceState(
      null,
      '',
      `/r/${ROOM}/hub#token=tok1&screen=scr1&review=rev1&code=K7M2QX`,
    );
    const first = readHubKeys(ROOM);
    expect(first.auctioneer).toBe('tok1');

    expect(stripHubFragment(ROOM)).toBe(true);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe(`/r/${ROOM}/hub`);
    expect(window.location.href).not.toContain('tok1');

    // Reload: memory gone, only sessionStorage and the now empty fragment remain.
    const raw = sessionStorage.getItem(`gavel:session:${ROOM}:hub`);
    expect(raw).not.toBeNull();
    const again = readHubKeys(ROOM, '', sessionStorage);
    expect(again.auctioneer).toBe('tok1');
    expect(again.screen).toBe('scr1');
    expect(again.reviewer).toBe('rev1');
    expect(again.code).toBe('K7M2QX');
  });

  it('leaves the URL alone when the fragment has no hub key', () => {
    window.history.replaceState(null, '', `/r/${ROOM}/hub?x=1#section`);
    expect(stripHubFragment(ROOM)).toBe(false);
    expect(window.location.hash).toBe('#section');
  });

  it('keeps the query string', () => {
    window.history.replaceState(null, '', `/r/${ROOM}/hub?x=1#token=tok2`);
    stripHubFragment(ROOM);
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('');
  });
});
