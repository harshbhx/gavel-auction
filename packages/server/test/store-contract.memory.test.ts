import { MemoryStore } from '../src/store/memory-store';
import { runStoreContract } from './store-contract';

runStoreContract(() => new MemoryStore(), 'MemoryStore');
