import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { forgetJudgeKey, readJudgeKey, rememberJudgeKey } from '../../src/net/judgeKey';
import { DemoRoomError, type DemoLinks } from '../../src/screens/demo/DemoLauncher';
import { JudgePanel, type JudgePanelProps } from '../../src/screens/judge/JudgePanel';

// Test-only constants, built at run time.
const KEY = ['test', 'judge', 'k'.repeat(32)].join('-');

const LINKS: DemoLinks = {
  console: '/r/r1/console#token=a',
  screen: '/r/r1/screen#token=s',
  bidder: '/join/r1',
  audit: '/r/r1/audit#token=v',
  hub: '/r/r1/hub#token=a',
};

beforeEach(() => {
  forgetJudgeKey();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  forgetJudgeKey();
});

function panel(over: Partial<JudgePanelProps> = {}) {
  return (
    <JudgePanel
      rooms="on"
      createRoom={() => Promise.resolve(LINKS)}
      openRoom={vi.fn()}
      joinByCode={() => Promise.resolve(true)}
      room={null}
      autoplay={false}
      {...over}
    />
  );
}

const field = (): HTMLInputElement => screen.getByLabelText(t('try.key.label')) as HTMLInputElement;

describe('judge key field on /try', () => {
  it('is not in the page when the host has no key', () => {
    render(panel());
    expect(screen.queryByLabelText(t('try.key.label'))).toBeNull();
  });

  it('is a password field with the deck hint when the host has a key', () => {
    render(panel({ keyOffered: true, checkKey: () => Promise.resolve('ok') }));
    expect(field().type).toBe('password');
    expect(field().autocomplete).toBe('off');
    expect(screen.getByText(t('try.key.hint'))).toBeTruthy();
  });

  it('says clearly when the key is wrong and keeps nothing', async () => {
    const checkKey = vi.fn(() => Promise.resolve('wrong' as const));
    render(panel({ keyOffered: true, checkKey }));
    fireEvent.change(field(), { target: { value: 'not-the-key' } });
    fireEvent.click(screen.getByRole('button', { name: t('try.key.unlock') }));
    expect((await screen.findByRole('alert')).textContent).toContain(t('try.key.wrong'));
    expect(readJudgeKey()).toBeNull();
    expect(screen.queryByText(t('try.key.active'))).toBeNull();
  });

  it('says what is missing when Unlock is pressed with nothing typed', () => {
    const checkKey = vi.fn(() => Promise.resolve('ok' as const));
    render(panel({ keyOffered: true, checkKey }));
    const unlock = screen.getByRole('button', { name: t('try.key.unlock') });
    expect(unlock.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(unlock);
    expect(checkKey).not.toHaveBeenCalled();
    expect(screen.getByText(t('try.key.typeKey'))).toBeTruthy();
  });

  it('says so when this connection is locked out, and when the server is down', async () => {
    const checkKey = vi
      .fn<(key: string) => Promise<'locked' | 'unreachable'>>()
      .mockResolvedValueOnce('locked')
      .mockResolvedValueOnce('unreachable');
    render(panel({ keyOffered: true, checkKey }));
    fireEvent.change(field(), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: t('try.key.unlock') }));
    expect((await screen.findByRole('alert')).textContent).toContain(t('try.key.locked'));
    fireEvent.click(screen.getByRole('button', { name: t('try.key.unlock') }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(t('try.key.unreachable')),
    );
  });

  it('unlocks, keeps the key in sessionStorage only, and sends it with the create call', async () => {
    const createRoom = vi.fn(() => Promise.resolve(LINKS));
    const openRoom = vi.fn();
    render(
      panel({ keyOffered: true, checkKey: () => Promise.resolve('ok'), createRoom, openRoom }),
    );
    fireEvent.change(field(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: t('try.key.unlock') }));
    expect(await screen.findByText(t('try.key.active'))).toBeTruthy();
    expect(readJudgeKey()).toBe(KEY);
    expect(window.localStorage.length).toBe(0);
    // The key is not left in the page and never in the address.
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(window.location.href).not.toContain(KEY);
    fireEvent.click(screen.getByRole('button', { name: t('try.a1.room') }));
    await waitFor(() => expect(openRoom).toHaveBeenCalledWith(LINKS.hub));
    expect(createRoom).toHaveBeenCalledWith(undefined, KEY);
    expect(openRoom.mock.calls.flat().join(' ')).not.toContain(KEY);
  });

  it('does not send a key it does not hold', async () => {
    const createRoom = vi.fn(() => Promise.resolve(LINKS));
    render(panel({ keyOffered: true, checkKey: () => Promise.resolve('ok'), createRoom }));
    fireEvent.click(screen.getByRole('button', { name: t('try.a1.room') }));
    await waitFor(() => expect(createRoom).toHaveBeenCalled());
    expect(createRoom).toHaveBeenCalledWith(undefined);
  });

  it('starts unlocked when this tab already holds a key, and forgets it on request', async () => {
    rememberJudgeKey(KEY);
    render(panel({ keyOffered: true, checkKey: () => Promise.resolve('ok') }));
    expect(screen.getByText(t('try.key.active'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('try.key.forget') }));
    expect(readJudgeKey()).toBeNull();
    expect(field().value).toBe('');
  });

  it('ignores a stored key when the host has no key', () => {
    rememberJudgeKey(KEY);
    const createRoom = vi.fn(() => Promise.resolve(LINKS));
    render(panel({ createRoom }));
    fireEvent.click(screen.getByRole('button', { name: t('try.a1.room') }));
    expect(createRoom).toHaveBeenCalledWith(undefined);
  });

  it('drops a key the host stops accepting and shows the error', async () => {
    rememberJudgeKey(KEY);
    const createRoom = vi.fn(() => Promise.reject(new DemoRoomError('keyWrong')));
    render(panel({ keyOffered: true, checkKey: () => Promise.resolve('ok'), createRoom }));
    fireEvent.click(screen.getByRole('button', { name: t('try.a1.room') }));
    expect((await screen.findByRole('alert')).textContent).toContain(t('try.key.wrong'));
    expect(readJudgeKey()).toBeNull();
    expect(field().value).toBe('');
  });

  it('names the keyed room cap', async () => {
    rememberJudgeKey(KEY);
    const createRoom = vi.fn(() => Promise.reject(new DemoRoomError('keyCap')));
    render(panel({ keyOffered: true, checkKey: () => Promise.resolve('ok'), createRoom }));
    fireEvent.click(screen.getByRole('button', { name: t('try.a1.room') }));
    expect((await screen.findByRole('alert')).textContent).toContain(t('try.key.cap'));
  });
});

describe('action bar clearance on /try', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--judge-bar-clear');
  });

  it('publishes the bar height so the page ends above it', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 96,
    } as DOMRect);
    const view = render(panel());
    expect(document.documentElement.style.getPropertyValue('--judge-bar-clear')).toBe('136px');
    view.unmount();
    expect(document.documentElement.style.getPropertyValue('--judge-bar-clear')).toBe('');
    vi.restoreAllMocks();
  });
});
