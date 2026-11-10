import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { VoiceControl } from '../../src/screens/console/VoiceControl';
import { FakeWebSocket, installFakeAudio, type FakeAudio } from '../support/fakeVoice';

let audio: FakeAudio;

function answerCapabilities(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })),
  );
}

beforeEach(() => {
  audio = installFakeAudio();
  answerCapabilities({ judgeRooms: false, accepting: false, simHolds: false, voiceReplay: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderVoice(extra: { closed?: boolean; scripted?: boolean } = {}) {
  return render(
    <VoiceControl
      apiBase="http://api.test"
      roomId="room-1"
      token="plain-fake-word"
      closed={false}
      entries={[]}
      {...extra}
    />,
  );
}

describe('recorded voice demo on the console (R-VOX-081)', () => {
  it('offers the demo, keeps the microphone off, and starts without asking for a microphone', async () => {
    renderVoice();
    const play = await screen.findByRole('button', { name: t('console.replay.start') });
    expect(screen.getByText(t('console.mic.reason.replay'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: t('console.mic.start') }).getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(play);
    await waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const ws = FakeWebSocket.last as FakeWebSocket;
    expect(ws.url).toBe('ws://api.test/audio?auction=room-1&source=mic');
    act(() => {
      ws.open();
    });
    expect(ws.texts[0]).toBe(JSON.stringify({ t: 'auth', token: 'plain-fake-word' }));
    expect(audio.getUserMedia).not.toHaveBeenCalled();
  });

  it('shows the host captions at their recorded offsets and sends no audio', async () => {
    renderVoice();
    fireEvent.click(await screen.findByRole('button', { name: t('console.replay.start') }));
    await waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const ws = FakeWebSocket.last as FakeWebSocket;
    act(() => {
      ws.open();
      ws.say({ t: 'ready' });
    });
    expect(await screen.findByText(t('console.replay.running'))).toBeTruthy();
    act(() => ws.say({ t: 'caption', text: 'Bidder four, three hundred.', final: true }));
    expect(
      screen.getByText(t('console.voice.heard', { text: 'Bidder four, three hundred.' })),
    ).toBeTruthy();
    expect(ws.binary).toHaveLength(0);
  });

  it('stops with the same button and closes the socket', async () => {
    renderVoice();
    fireEvent.click(await screen.findByRole('button', { name: t('console.replay.start') }));
    await waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const ws = FakeWebSocket.last as FakeWebSocket;
    act(() => {
      ws.open();
      ws.say({ t: 'ready' });
    });
    fireEvent.click(await screen.findByRole('button', { name: t('console.replay.stop') }));
    expect(ws.closedWith).toBe(1000);
    expect(await screen.findByRole('button', { name: t('console.replay.start') })).toBeTruthy();
  });

  it('says what went wrong when the host refuses the connection', async () => {
    renderVoice();
    fireEvent.click(await screen.findByRole('button', { name: t('console.replay.start') }));
    await waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    act(() => (FakeWebSocket.last as FakeWebSocket).serverClose(4401));
    expect(await screen.findByText(t('console.voice.p.unauthorized'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('console.replay.start') })).toBeTruthy();
  });

  it('is not offered with live speech, without the flag, once closed, or in the scripted demo', async () => {
    answerCapabilities({ voice: true, voiceReplay: true });
    const live = renderVoice();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: t('console.mic.start') }).getAttribute('aria-disabled'),
      ).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: t('console.replay.start') })).toBeNull();
    live.unmount();

    answerCapabilities({ judgeRooms: true });
    const none = renderVoice();
    expect(await screen.findByText(t('console.mic.reason.off'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('console.replay.start') })).toBeNull();
    none.unmount();

    answerCapabilities({ voiceReplay: true });
    const closed = renderVoice({ closed: true });
    expect(await screen.findByText(t('console.mic.reason.closed'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('console.replay.start') })).toBeNull();
    closed.unmount();

    renderVoice({ scripted: true });
    expect(screen.queryByRole('button', { name: t('console.replay.start') })).toBeNull();
  });
});
