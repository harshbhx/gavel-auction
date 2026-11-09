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
 *
 * Saga leases are not carried over (RT4-saga-02): a lease belongs to the process that
 * took it, and one process owns the file (the server takes the data directory lock
 * before it opens the stores). A lease found in the file was left by a process that
 * was killed before its `finally` ran, so honouring it would only block the restarted
 * process from resuming the settlement until the lease expired. For the same reason taking
 * or releasing a lease writes nothing: it kept two full rewrites in every settlement run.
 *
 * Writes stay synchronous and one per mutation, on purpose: a hold, a journal step or a
 * webhook event is durable before its call returns, and batching or debouncing would let
 * the caller act on money state the disk does not have yet. Archiving settled journals and
 * terminal holds is not done either, because they are the evidence for a settled lot.
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
    const saved = readJson<JournalSnapshot>(path, { journals: {}, leases: {} });
    super({ journals: saved.journals, leases: {} }, (s) => writeJsonAtomic(path, s), false);
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
