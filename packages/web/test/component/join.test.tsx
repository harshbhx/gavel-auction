import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { JoinScreen, joinUrl } from '../../src/screens/join/JoinScreen';

const ORIGIN = 'https://gavel.example';

describe('join screen (T-WEB-032)', () => {
  it('builds the join url with the short code', () => {
    expect(joinUrl(ORIGIN, 'room1', 'ABC123')).toBe(`${ORIGIN}/join/room1?c=ABC123`);
  });

  it('shows the room name, the code and a QR whose text is the url', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(
      <JoinScreen
        roomId="room1"
        roomName="Gala"
        shortCode="ABC123"
        state="open"
        origin={ORIGIN}
        onNavigate={() => undefined}
        hasSession={false}
      />,
    );
    expect(screen.getByRole('heading', { name: t('join.title', { room: 'Gala' }) })).toBeTruthy();
    expect(screen.getByText(t('join.code', { code: 'ABC123' }))).toBeTruthy();
    const qr = await screen.findByRole('img');
    expect(qr.getAttribute('aria-label')).toBe(`${ORIGIN}/join/room1?c=ABC123`);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('sends a returning bidder straight to bid', () => {
    const onNavigate = vi.fn();
    render(
      <JoinScreen
        roomId="room1"
        roomName="Gala"
        shortCode="ABC123"
        state="open"
        origin={ORIGIN}
        onNavigate={onNavigate}
        hasSession
      />,
    );
    expect(onNavigate).toHaveBeenCalledWith('/r/room1/bid');
  });

  it('shows the not found and ended states', () => {
    const { rerender } = render(
      <JoinScreen
        roomId="room1"
        roomName={null}
        shortCode={null}
        state="notFound"
        origin={ORIGIN}
        onNavigate={() => undefined}
        hasSession={false}
      />,
    );
    expect(screen.getByText(t('join.notFound'))).toBeTruthy();
    rerender(
      <JoinScreen
        roomId="room1"
        roomName="Gala"
        shortCode={null}
        state="ended"
        origin={ORIGIN}
        onNavigate={() => undefined}
        hasSession={false}
      />,
    );
    expect(screen.getByText(t('join.ended'))).toBeTruthy();
  });

  it('shows the two steps still ahead, starting at step 2', () => {
    render(
      <JoinScreen
        roomId="room1"
        roomName="Gala"
        shortCode="ABC123"
        state="open"
        origin={ORIGIN}
        onNavigate={() => undefined}
        hasSession={false}
      />,
    );
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[0]?.getAttribute('aria-current')).toBe('step');
    expect(steps[0]?.textContent).toBe(t('join.step2'));
    expect(screen.getByText(t('join.sandboxNote'))).toBeTruthy();
  });

  it('offers a way out of the not found, ended and full states', () => {
    const onNavigate = vi.fn();
    const base = {
      roomId: 'room1',
      shortCode: null,
      origin: ORIGIN,
      onNavigate,
      hasSession: false,
    } as const;
    const { rerender } = render(<JoinScreen {...base} roomName={null} state="notFound" />);
    expect(screen.getByText(t('join.notFoundHelp'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('join.tryAgain') }).getAttribute('href')).toBe('/');
    expect(screen.queryByText(t('join.sandboxNote'))).toBeNull();
    rerender(<JoinScreen {...base} roomName="Gala" state="ended" />);
    expect(screen.getByText(t('join.endedHelp'))).toBeTruthy();
    rerender(<JoinScreen {...base} roomName="Gala" state="full" />);
    expect(screen.getByText(t('join.full'))).toBeTruthy();
    screen.getByRole('button', { name: t('join.watch') }).click();
    expect(onNavigate).toHaveBeenCalledWith('/r/room1/bid');
  });
});
