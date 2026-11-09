import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import {
  CHUNK_RELOAD_KEY,
  ChunkBoundary,
  lazyWithRetry,
  reloadForChunk,
} from '../../src/screens/states/ChunkBoundary';

// FIX-84 (#2227): a lazy chunk that fails to load (deploy race, stale edge answering with HTML)
// must not take down the whole screen: only its own spot shows a message and a Reload button.

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('reloadForChunk', () => {
  it('reloads once, then refuses inside the 30 s window so there is no loop', () => {
    const storage = memory();
    const reload = vi.fn();
    expect(reloadForChunk({ storage, reload, now: () => 1_000 })).toBe(true);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('1000');
    expect(reloadForChunk({ storage, reload, now: () => 20_000 })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForChunk({ storage, reload, now: () => 31_001 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads without usable storage', () => {
    const reload = vi.fn();
    expect(reloadForChunk({ storage: null, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('ChunkBoundary', () => {
  it('shows a recoverable message with Reload for a failed chunk, and keeps the rest of the page', async () => {
    const quiet = vi.spyOn(globalThis.console, 'error').mockImplementation(() => undefined);
    const onReload = vi.fn();
    const reload = vi.fn();
    const Broken = lazyWithRetry(
      () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
      { storage: memory({ [CHUNK_RELOAD_KEY]: '1000' }), now: () => 2_000, reload },
    );
    render(
      <div>
        <p>rest of the page</p>
        <ChunkBoundary onReload={onReload}>
          <Broken />
        </ChunkBoundary>
      </div>,
    );
    await waitFor(() => expect(screen.getByTestId('chunk-error')).toBeTruthy());
    quiet.mockRestore();
    expect(screen.getByText('rest of the page')).toBeTruthy();
    expect(screen.getByText(t('err.chunk'))).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('err.reload') }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('reloads once on the first failure and keeps the loading fallback meanwhile', async () => {
    const reload = vi.fn();
    const Broken = lazyWithRetry(() => Promise.reject(new Error('chunk gone')), {
      storage: memory(),
      now: () => 5_000,
      reload,
    });
    render(
      <ChunkBoundary fallback={<p>loading</p>}>
        <Broken />
      </ChunkBoundary>,
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText('loading')).toBeTruthy();
    expect(screen.queryByTestId('chunk-error')).toBeNull();
  });

  it('renders a chunk that loads', async () => {
    const Fine = lazyWithRetry(() => Promise.resolve({ default: () => <p>qr code</p> }));
    render(
      <ChunkBoundary>
        <Fine />
      </ChunkBoundary>,
    );
    await waitFor(() => expect(screen.getByText('qr code')).toBeTruthy());
  });
});
