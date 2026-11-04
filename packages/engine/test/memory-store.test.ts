import { InMemoryLedgerStore } from '../src/ledger/memory-store.js';
import { runStoreContract } from '../src/testing/store-contract.js';

// T-ENG-075 (R-ENG-104): the in-memory adapter passes the shared contract.
runStoreContract(() => Promise.resolve(new InMemoryLedgerStore()));
