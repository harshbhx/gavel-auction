import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { LiveConsole } from '../../src/screens/console/LiveConsole';
import { VoiceControl } from '../../src/screens/console/VoiceControl';
import { roomStore } from '../../src/store/roomStore';
import { FakeWebSocket, installFakeAudio, tone, type FakeAudio } from '../support/fakeVoice';

let audio: FakeAudio;

function answerCapabilities(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })),
  );
}

beforeEach(() => {
  audio = installFakeAudio();
  answerCapabilities({ judgeRooms: true, accepting: true, simHolds: true, voice: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  roomStore.enter('');
});

function renderVoice(extra: { closed?: boolean; scripted?: boolean } = {}) {
  const props = {
    apiBase: 'http://api.test',
    roomId: 'room-1',
    token: 'plain-fake-word',
    closed: false,
    entries: [],
    ...extra,
  };
  const view = render(<VoiceControl {...props} />);
  return { ...view, props };
}

const micButton = (name: string) => screen.getByRole('button', { name });

/** Waits for the capability probe, then clicks the start button. */
async function start(): Promise<void> {
  await waitFor(() =>
    expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBeNull(),
  );
  fireEvent.click(micButton(t('console.mic.start')));
}

/** The host accepts the connection and says ready. */
async function hostReady(): Promise<FakeWebSocket> {
  await waitFor(() => expect(FakeWebSocket.last).toBeDefined());
  const ws = FakeWebSocket.last as FakeWebSocket;
  await waitFor(() => expect(audio.getUserMedia).toHaveBeenCalled());
  act(() => {
    ws.open();
    ws.say({ t: 'ready' });
  });
  return ws;
}

describe('microphone is enabled only when the server reports voice', () => {
  it('is disabled with a reason while the answer is pending, then enabled', async () => {
    renderVoice();
    expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(t('console.mic.reason.checking'))).toBeTruthy();
    await waitFor(() =>
      expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBeNull(),
    );
    expect(screen.getByText(t('console.mic.off'))).toBeTruthy();
    expect(screen.getByText(t('console.voice.privacy'))).toBeTruthy();
  });

  it('stays disabled, with the reason, when the server has no live speech provider', async () => {
    answerCapabilities({ judgeRooms: true, accepting: true, simHolds: true });
    renderVoice();
    expect(await screen.findByText(t('console.mic.reason.off'))).toBeTruthy();
    fireEvent.click(micButton(t('console.mic.start')));
    expect(audio.getUserMedia).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('stays disabled when the server cannot be asked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    renderVoice();
    expect(await screen.findByText(t('console.mic.reason.unreachable'))).toBeTruthy();
    expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBe('true');
  });

  it('does not ask the server at all in the scripted demo', () => {
    renderVoice({ scripted: true });
    expect(screen.getByText(t('console.mic.reason.scripted'))).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBe('true');
  });

  it('is disabled once the lot is closed', async () => {
    renderVoice({ closed: true });
    expect(await screen.findByText(t('console.mic.reason.closed'))).toBeTruthy();
  });

  it('is part of the live console, never started on its own', async () => {
    render(
      <LiveConsole
        room={null}
        roomId="lot-one"
        token="plain-fake-word"
        apiBase="http://api.test"
        onConfirmAnswer={() => undefined}
        rejection=""
      />,
    );
    await waitFor(() =>
      expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBeNull(),
    );
    expect(audio.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('permission states are said plainly', () => {
  it('tells how to fix a blocked microphone', async () => {
    audio.getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    renderVoice();
    await start();
    expect(await screen.findByText(t('console.mic.denied'))).toBeTruthy();
    expect(screen.getByText(t('console.mic.deniedHelp'))).toBeTruthy();
    expect(micButton(t('console.mic.start'))).toBeTruthy();
  });

  it('says there is no microphone', async () => {
    audio.getUserMedia.mockRejectedValueOnce(new DOMException('none', 'NotFoundError'));
    renderVoice();
    await start();
    expect(await screen.findByText(t('console.mic.nomic'))).toBeTruthy();
  });

  it('says it is asking while the browser prompt is open', async () => {
    audio.getUserMedia.mockReturnValueOnce(new Promise(() => undefined));
    renderVoice();
    await start();
    expect(await screen.findByText(t('console.mic.requesting'))).toBeTruthy();
    expect(micButton(t('console.mic.stop'))).toBeTruthy();
  });

  it('says so, before any click, in a browser without audio support', async () => {
    vi.stubGlobal('AudioWorkletNode', undefined);
    renderVoice();
    expect(await screen.findByText(t('console.mic.unsupported'))).toBeTruthy();
    expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBe('true');
  });

  it('says what went wrong when the server refuses the connection', async () => {
    renderVoice();
    await start();
    const ws = await hostReady();
    act(() => ws.serverClose(4401));
    expect(await screen.findByText(t('console.voice.p.unauthorized'))).toBeTruthy();
    expect(micButton(t('console.mic.start'))).toBeTruthy();
    expect(audio.stopTrack).toHaveBeenCalled();
  });
});

describe('listening and sending', () => {
  it('goes live after ready, sends audio frames, shows captions and releases on unmount', async () => {
    const view = renderVoice();
    await start();
    const ws = await hostReady();
    expect(await screen.findByText(t('console.mic.live'))).toBeTruthy();
    expect(ws.url).toBe('ws://api.test/audio?auction=room-1&source=mic');
    expect(ws.url).not.toContain('plain-fake-word');
    expect(ws.texts[0]).toBe(JSON.stringify({ t: 'auth', token: 'plain-fake-word' }));

    act(() => audio.block(tone(1600, 0.3)));
    expect(ws.binary).toHaveLength(1);
    expect(ws.binary[0]?.[0]).toBe(0x56);
    const meter = screen.getByRole('meter');
    expect(Number(meter.getAttribute('value'))).toBeGreaterThan(0.2);

    act(() => ws.say({ t: 'caption', text: 'paddle three two hundred', final: false }));
    expect(
      screen.getByText(t('console.voice.hearing', { text: 'paddle three two hundred' })),
    ).toBeTruthy();
    act(() => ws.say({ t: 'caption', text: 'paddle three two hundred', final: true }));
    expect(
      screen.getByText(t('console.voice.heard', { text: 'paddle three two hundred' })),
    ).toBeTruthy();

    view.unmount();
    expect(audio.stopTrack).toHaveBeenCalled();
    expect(audio.closeContext).toHaveBeenCalled();
    expect(ws.closedWith).toBe(1000);
  });

  it('says what became of a spoken bid: held for the bidder, or why there was none (UIX-77)', async () => {
    renderVoice();
    await start();
    const ws = await hostReady();
    act(() => ws.say({ t: 'caption', text: 'paddle three two hundred', final: true }));
    // Heard text alone is not enough: no outcome line yet.
    expect(document.querySelector('[data-slot="voice-outcome"]')).toBeNull();

    act(() => ws.say({ t: 'outcome', kind: 'confirm', paddle: 3 }));
    expect(screen.getByText(t('console.voice.outcome.confirm', { n: 3 }))).toBeTruthy();

    act(() => ws.say({ t: 'outcome', kind: 'drop', reason: 'unregistered_paddle' }));
    expect(screen.getByText(t('console.voice.outcome.noPaddle'))).toBeTruthy();
    expect(screen.queryByText(t('console.voice.outcome.confirm', { n: 3 }))).toBeNull();

    act(() => ws.say({ t: 'outcome', kind: 'drop', reason: 'no_amount' }));
    expect(screen.getByText(t('console.voice.outcome.noAmount'))).toBeTruthy();
  });

  it('turns the microphone off with the same button', async () => {
    renderVoice();
    await start();
    const ws = await hostReady();
    fireEvent.click(micButton(t('console.mic.stop')));
    expect(ws.closedWith).toBe(1000);
    expect(audio.stopTrack).toHaveBeenCalled();
    expect(screen.getByText(t('console.mic.off'))).toBeTruthy();
  });

  it('releases the microphone when the lot closes', async () => {
    const view = renderVoice();
    await start();
    await hostReady();
    view.rerender(<VoiceControl {...view.props} closed />);
    await waitFor(() => expect(audio.stopTrack).toHaveBeenCalled());
    expect(await screen.findByText(t('console.voice.p.closed'))).toBeTruthy();
  });
});

describe('push to talk', () => {
  it('sends only while the button is held', async () => {
    renderVoice();
    await waitFor(() =>
      expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBeNull(),
    );
    fireEvent.click(screen.getByLabelText(t('console.mic.modeHold')));
    const button = micButton(t('console.mic.holdButton'));
    fireEvent.pointerDown(button);
    const ws = await hostReady();
    expect(await screen.findByRole('button', { name: t('console.mic.holdActive') })).toBeTruthy();
    act(() => audio.block(tone(1600, 0.3)));
    expect(ws.binary).toHaveLength(1);
    fireEvent.pointerUp(micButton(t('console.mic.holdActive')));
    const after = ws.binary.length;
    // The utterance end goes out as a keepalive, and later audio is not sent.
    expect(ws.binary.at(-1)?.length).toBe(12);
    act(() => audio.block(tone(1600, 0.3)));
    expect(ws.binary).toHaveLength(after);
    expect(micButton(t('console.mic.holdButton'))).toBeTruthy();
    expect(screen.getByText(t('console.mic.armed'))).toBeTruthy();
  });

  it('works from the keyboard with Space', async () => {
    renderVoice();
    await waitFor(() =>
      expect(micButton(t('console.mic.start')).getAttribute('aria-disabled')).toBeNull(),
    );
    fireEvent.click(screen.getByLabelText(t('console.mic.modeHold')));
    const button = micButton(t('console.mic.holdButton'));
    fireEvent.keyDown(button, { key: ' ' });
    const ws = await hostReady();
    expect(await screen.findByRole('button', { name: t('console.mic.holdActive') })).toBeTruthy();
    act(() => audio.block(tone(1600, 0.3)));
    expect(ws.binary).toHaveLength(1);
    fireEvent.keyUp(micButton(t('console.mic.holdActive')), { key: ' ' });
    expect(screen.getByText(t('console.mic.armed'))).toBeTruthy();
  });
});
