import { MemoryStore } from '../src/store/memory';
import { runStoreContract } from './store-contract';

// T-RT-066: MemoryStore passes the contract suite.
runStoreContract(() => new MemoryStore(), 'MemoryStore (memory.ts)');
