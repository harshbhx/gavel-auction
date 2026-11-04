import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync } from './atomic.js';
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
 * snapshot written after every mutation (fsynced unique temp file, rename, fsynced
 * directory, so a crash leaves the old or the new file, never a mix). One process
 * owns a file; there is no cross-process locking, and a second writer on the same
 * path overwrites the first. A new instance on the same path sees the saved state,
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
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `store file ${path} is not valid JSON (${e instanceof Error ? e.message : String(e)}); restore it from a backup instead of starting empty`,
    );
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  writeFileAtomicSync(path, JSON.stringify(value));
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
