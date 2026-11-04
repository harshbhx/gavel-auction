import { step } from '../../src/saga/machine.js';
import type { MemoryJournalStore } from '../../src/stores/memory.js';
import type { Journal } from '../../src/types.js';

/**
 * The journal after the capture phase, moved on to SETTLED the way the release phase
 * will (begin_void, all_released), so the bridge sees a finished settlement.
 */
export async function runSettlementTail(rig: { journals: MemoryJournalStore }): Promise<Journal> {
  const first = Object.keys(rig.journals.snapshot().journals)[0];
  if (first === undefined) throw new Error('no journal');
  let journal = await rig.journals.load(first);
  if (journal === null) throw new Error('no journal');
  if (journal.state === 'CAPTURED') {
    journal = step(journal, { type: 'begin_void', tsMs: journal.history.length + 100 }).journal;
  }
  return step(journal, { type: 'all_released', tsMs: journal.history.length + 101 }).journal;
}
