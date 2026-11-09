import {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';

/** sessionStorage key that holds the time of the last automatic chunk reload. */
export const CHUNK_RELOAD_KEY = 'gavel.chunkReload';
/** A second chunk failure inside this window shows the message instead of reloading again. */
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

export interface ChunkRecovery {
  now?: () => number;
  reload?: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Called when a lazy chunk failed to load (a deploy replaced it, or a stale edge answered with
 * HTML). Reloads the page once to pick up the new build; returns false when a reload already
 * happened in the last 30 s, so a chunk that is really gone cannot cause a reload loop.
 */
export function reloadForChunk(opts: ChunkRecovery = {}): boolean {
  const now = (opts.now ?? Date.now)();
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  try {
    if (storage === null) return false;
    const stored = storage.getItem(CHUNK_RELOAD_KEY);
    const last = stored === null ? Number.NaN : Number(stored);
    if (Number.isFinite(last) && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  (opts.reload ?? (() => window.location.reload()))();
  return true;
}

/** `lazy()` whose failed import triggers one guarded reload; after that the error reaches the boundary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  recovery?: ChunkRecovery,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((error: unknown) => {
      // While the page reloads, keep the Suspense fallback up instead of flashing the error.
      if (reloadForChunk(recovery)) return new Promise<never>(() => undefined);
      throw error;
    }),
  );
}

interface ChunkBoundaryProps {
  readonly children: ReactNode;
  /** Shown while the chunk loads. */
  readonly fallback?: ReactNode;
  /** Test seam. Defaults to a full page reload. */
  readonly onReload?: () => void;
}

/**
 * Local error boundary for lazy chunks: a failed chunk replaces only its own spot with a short
 * message and a Reload button, not the whole screen (the root ErrorBoundary stays for real bugs).
 */
export class ChunkBoundary extends Component<ChunkBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert" data-testid="chunk-error">
          <p>{t('err.chunk')}</p>
          <Button onClick={this.props.onReload ?? (() => window.location.reload())}>
            {t('err.reload')}
          </Button>
        </div>
      );
    }
    return <Suspense fallback={this.props.fallback ?? null}>{this.props.children}</Suspense>;
  }
}
