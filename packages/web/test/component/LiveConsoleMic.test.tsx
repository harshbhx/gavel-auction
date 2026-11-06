import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { LiveConsole } from '../../src/screens/console/LiveConsole';

const stopTrack = vi.fn();
const closeCtx = vi.fn(() => Promise.resolve());
const getUserMedia = vi.fn();

class FakeAudioContext {
  sampleRate = 16000;
  audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  close = closeCtx;
}

class FakeWorkletNode {
  static last: FakeWorkletNode | null = null;
  port: { onmessage: ((ev: { data: Float32Array }) => void) | null } = { onmessage: null };
  constructor() {
    FakeWorkletNode.last = this;
  }
}

function renderConsole(sink = { push: vi.fn() }) {
  return {
    sink,
    ...render(
      <LiveConsole
        room={null}
        roomId="lot-one"
        token="plain-fake-word"
        apiBase="http://localhost"
        onConfirmAnswer={() => undefined}
        rejection=""
        audioSink={sink}
      />,
    ),
  };
}

beforeEach(() => {
  stopTrack.mockClear();
  closeCtx.mockClear();
  getUserMedia.mockReset();
  FakeWorkletNode.last = null;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LiveConsole microphone', () => {
  it('does not ask for the microphone until the button is pressed', () => {
    renderConsole();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText(t('console.mic.off'))).toBeTruthy();
  });

  it('goes live on press, forwards frames, and stops on unmount', async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    const { sink, unmount } = renderConsole();
    fireEvent.click(screen.getByText(t('console.mic.start')));
    await waitFor(() => expect(screen.getByText(t('console.mic.live'))).toBeTruthy());
    act(() => {
      FakeWorkletNode.last?.port.onmessage?.({ data: new Float32Array([0.1, -0.1, 0.2]) });
    });
    expect(sink.push).toHaveBeenCalledTimes(1);
    unmount();
    expect(stopTrack).toHaveBeenCalled();
    expect(closeCtx).toHaveBeenCalled();
  });

  it('says so when permission is denied', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    renderConsole();
    fireEvent.click(screen.getByText(t('console.mic.start')));
    await waitFor(() => expect(screen.getByText(t('console.mic.denied'))).toBeTruthy());
  });
});
