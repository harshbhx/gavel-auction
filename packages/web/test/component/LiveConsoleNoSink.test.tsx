import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { LiveConsole } from '../../src/screens/console/LiveConsole';

const getUserMedia = vi.fn();

beforeEach(() => {
  getUserMedia.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LiveConsole without an audio path', () => {
  it('shows the microphone as not available and never listens', () => {
    render(
      <LiveConsole
        room={null}
        roomId="lot-one"
        token="plain-fake-word"
        apiBase="http://localhost"
        onConfirmAnswer={() => undefined}
        rejection=""
      />,
    );
    const button = screen.getByRole('button', { name: t('console.mic.start') });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText(t('console.mic.unavailable'))).toBeTruthy();
    expect(screen.queryByText(t('console.mic.live'))).toBeNull();
    expect(screen.queryByText(t('console.mic.off'))).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });
});
