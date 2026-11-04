import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MemoryHoldStore,
  MemoryJournalStore,
  MemoryWebhookEventStore,
  type HoldSnapshot,
  type JournalSnapshot,
  type WebhookSnapshot,
} from './memory.js';

/**
 * JSON-file stores for demos and crash tests: the in-memory behaviour plus a
 * snapshot written after every mutation (temp file, then rename, so a reader
 * never sees a half-written file). One process owns a file; there is no
 * cross-process locking. A new instance on the same path sees the saved state,
 * which is how tests model a restart.
 */

function readJson<T>(path: string, empty: T): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return empty;
    throw e;
  }
  return JSON.parse(text) as T;
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), 'utf8');
  renameSync(tmp, path);
}

export class FileJournalStore extends MemoryJournalStore {
  constructor(readonly path: string) {
    super(readJson<JournalSnapshot>(path, { journals: {}, leases: {} }), (s) =>
      writeJsonAtomic(path, s),
    );
  }
}

export class FileWebhookEventStore extends MemoryWebhookEventStore {
  constructor(readonly path: string) {
    super(readJson<WebhookSnapshot>(path, { events: {} }), (s) => writeJsonAtomic(path, s));
  }
}

export class FileHoldStore extends MemoryHoldStore {
  constructor(readonly path: string) {
    super(readJson<HoldSnapshot>(path, { holds: {} }), (s) => writeJsonAtomic(path, s));
  }
}

export interface FileStores {
  journals: FileJournalStore;
  webhooks: FileWebhookEventStore;
  holds: FileHoldStore;
}

/** The three stores under one directory: journals.json, webhooks.json, holds.json. */
export function openFileStores(dir: string): FileStores {
  return {
    journals: new FileJournalStore(join(dir, 'journals.json')),
    webhooks: new FileWebhookEventStore(join(dir, 'webhooks.json')),
    holds: new FileHoldStore(join(dir, 'holds.json')),
  };
}
