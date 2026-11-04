/**
 * GAVEL deterministic auction engine, legacy single-lot entry point. The `Auction` class
 * now runs on the decide/evolve core (R-ENG-116); see `legacy.ts`.
 */
export { Auction, Rejected } from './legacy.js';
export type { AuctionOptions, Bid, Mode, Outcome, State } from './legacy.js';
