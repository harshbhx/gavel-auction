import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { judgeRoomsStatus } from '../../src/net/judgeRooms';
import { JudgePanel } from '../../src/screens/try/JudgePanel';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(answer: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => Promise.resolve(answer(url))),
  );
}

describe('/try judge panel', () => {
  it('shows the pitch, the five steps, the scripted demo and the buyer notes', () => {
    render(<App initialPath="/try" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('try.title'));
    expect(screen.getAllByRole('heading', { level: 3, name: /./ }).length).toBeGreaterThan(8);
    expect(screen.getByText(t('try.s5.title'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('try.script.run') }).getAttribute('href')).toBe(
      '/demo/scripted',
    );
    expect(screen.getByText(t('try.buyer.warn'))).toBeTruthy();
    expect(screen.getByText(t('try.key.body'))).toBeTruthy();
    expect(screen.getByText(t('try.faq.q1'))).toBeTruthy();
  });

  it('has no server in this build: start is blocked and the scripted demo is offered', () => {
    render(<App initialPath="/try" />);
    expect(screen.getByText(t('try.status.noServer'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: t('try.s1.cta') }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain(t('try.s1.open'));
    expect(screen.getByText(t('try.s2.noServer'))).toBeTruthy();
  });

  it('starts a room and opens its page', async () => {
    const createRoom = vi.fn(() =>
      Promise.resolve({ console: '/c', screen: '/s', bidder: '/b', audit: '/a', hub: '/r/x/hub' }),
    );
    const openRoom = vi.fn();
    render(
      <JudgePanel
        rooms="on"
        createRoom={createRoom}
        openRoom={openRoom}
        joinByCode={() => Promise.resolve(true)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('try.s1.cta') }));
    await waitFor(() => expect(openRoom).toHaveBeenCalledWith('/r/x/hub'));
  });

  it('says why a room could not be made and keeps the scripted demo in reach', async () => {
    render(
      <JudgePanel
        rooms="on"
        createRoom={() => Promise.reject(new Error('down'))}
        openRoom={vi.fn()}
        joinByCode={() => Promise.resolve(true)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('try.s1.cta') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('try.s1.failed'));
    expect(alert.textContent).toContain(t('demo.failed'));
    expect(screen.getAllByRole('link', { name: t('demo.scriptedInstead') }).length).toBe(1);
  });

  it('reports an unknown room code', async () => {
    render(
      <JudgePanel
        rooms="on"
        createRoom={() => Promise.reject(new Error('unused'))}
        openRoom={vi.fn()}
        joinByCode={() => Promise.resolve(false)}
      />,
    );
    fireEvent.change(screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 })), {
      target: { value: 'NOROOM' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('try.s2.go') }));
    await waitFor(() =>
      expect(screen.getAllByText(t('landing.codeInvalid')).length).toBeGreaterThan(0),
    );
  });
});

describe('judgeRoomsStatus', () => {
  it('maps the host answer to a status', async () => {
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status });
    stubFetch(() => json({ judgeRooms: true, accepting: true }));
    expect(await judgeRoomsStatus('http://api')).toBe('on');
    stubFetch(() => json({ judgeRooms: true, accepting: false }));
    expect(await judgeRoomsStatus('http://api')).toBe('busy');
    stubFetch(() => json({ judgeRooms: false, accepting: false }));
    expect(await judgeRoomsStatus('http://api')).toBe('off');
    stubFetch(() => json({}, 404));
    expect(await judgeRoomsStatus('http://api')).toBe('off');
    stubFetch(() => json({}, 500));
    expect(await judgeRoomsStatus('http://api')).toBe('unreachable');
    stubFetch(() => Promise.reject(new Error('network')));
    expect(await judgeRoomsStatus('http://api')).toBe('unreachable');
  });
});
