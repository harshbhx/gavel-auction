import type { LlmOutput } from './schema.js';
import { parseLlmOutput } from './schema.js';

/**
 * Recorded model outputs for replay and CI (R-VOX-060). Entries are keyed by
 * sha256(transcript + context) so results are deterministic and need no key.
 */

/** Raised in replay mode when no recorded output exists for the input. Fails the test, no network. */
export class LlmCacheMissError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`no recorded model output for key ${key}`);
    this.name = 'LlmCacheMissError';
    this.key = key;
  }
}

/** Key-value persistence behind the cache; a directory of json files in practice. */
export interface LlmCacheStore {
  read(key: string): string | undefined;
  write(key: string, value: string): void;
}

export interface LlmCache {
  get(key: string): LlmOutput | undefined;
  set(key: string, output: LlmOutput): void;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** sha256 hex of the transcript followed by the canonical form of the context. */
export async function cacheKey(transcript: string, context: unknown): Promise<string> {
  const data = new TextEncoder().encode(`${transcript}\n${sortedJson(context)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createCache(store: LlmCacheStore): LlmCache {
  return {
    get(key) {
      const raw = store.read(key);
      if (raw === undefined) return undefined;
      return parseLlmOutput(raw) ?? undefined;
    },
    set(key, output) {
      store.write(key, `${JSON.stringify(output, null, 2)}\n`);
    },
  };
}

export function createMemoryStore(initial: Record<string, string> = {}): LlmCacheStore & {
  readonly entries: ReadonlyMap<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    entries: map,
    read: (key) => map.get(key),
    write: (key, value) => {
      map.set(key, value);
    },
  };
}

/** The slice of node:fs a directory store needs; injected so this module stays free of node imports. */
export interface DirFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  mkdirSync(path: string, options: { recursive: true }): unknown;
  existsSync(path: string): boolean;
}

/** One `<key>.json` file per entry under `dir` (fixtures/llm-cache). */
export function createDirStore(dir: string, fs: DirFs): LlmCacheStore {
  const pathOf = (key: string): string => `${dir}/${key}.json`;
  return {
    read(key) {
      const p = pathOf(key);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
    write(key, value) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(pathOf(key), value);
    },
  };
}
