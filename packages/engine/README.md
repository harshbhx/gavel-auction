# @gavel/engine

The pure auction core: `decide(state, command)` returns ledger events, `evolve(state, entry)` applies them, and `replay(entries)` rebuilds state from a ledger. The core has no Node built-ins and no runtime dependencies, so it runs in browsers and edge runtimes. `src/index.ts` is the only public surface; its exported names are listed in `api.snapshot.txt`, and a change to the surface must update that file. Node-only helpers are in `@gavel/engine/node`.

Scripts (run from the repository root):

- `npm run test -w @gavel/engine` unit, property and fixture tests
- `npm run typecheck -w @gavel/engine`
- `npm run lint -w @gavel/engine` eslint and the import boundary check
- `npm run check:bundle -w @gavel/engine` browser bundle without `node:` imports
- `npm run check:trace -w @gavel/engine` every `R-ENG-` id is named by a test

## Commands

Every command carries `type`, `commandId` (ULID), `at` (integer epoch ms) and `auctionId`. Money is integer cents. Parse untrusted input with `parseCommand`.

| Command            | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `CreateAuction`    | Open an auction with its config                                |
| `AddLot`           | Add a lot (mode, reserve, increment rule, soft close)          |
| `RegisterBidder`   | Register a bidder with a ceiling                               |
| `OpenLot`          | Start bidding on a lot                                         |
| `PlaceBid`         | Place a bid (accepted, rejected with a reason, or duplicate)   |
| `Tick`             | Advance the clock for a lot                                    |
| `Hammer`           | Close a lot and pick the winner                                |
| `RevokeCeiling`    | Remove a bidder's ceiling and strike their bids                |
| `PromoteRunnerUp`  | Offer the lot to the next candidate                            |
| `AbortLot`         | Cancel an open lot as unsold                                   |
| `PauseLot`         | Freeze an open lot's clock and reject bids                     |
| `ResumeLot`        | Restart a paused clock with the time that was left             |
| `ExtendLot`        | Add time to a running lot (auctioneer extension)               |
| `CompleteLot`      | Finish a lot after settlement                                  |
| `RecordSettlement` | Record a settlement state edge (for example HELD to CAPTURING) |
| `CloseAuction`     | Close the auction                                              |

`decide` returns an outcome (`ok`, `rejected`, `duplicate` or an error) and the entries to append. A rejected bid is itself a ledger entry (`BID_REJECTED`) with a reason from `REJECT_REASONS`.

## Ledger format

A ledger is an ordered list of entries for one auction. Each entry has `v` (always 1), `auctionId`, `seq` (starting at 1), `at`, `type`, `cmd`, `payload`, `prev` and `hash`. The first entry is `AUCTION_CREATED` and its `prev` is 64 zeros; every later `prev` is the previous entry's `hash`. `verifyChain(entries)` checks sequence, time order, links and hashes and reports the first bad index.

Export and verify without a server:

```ts
import { exportJsonl, verifyJsonl } from '@gavel/engine';

const text = exportJsonl(entries); // one canonical JSON entry per line
verifyJsonl(text); // { ok: true, count, headHash } or { ok: false, firstBadIndex, reason }
```

```sh
npx verify-ledger ledger.jsonl
# OK 3 entries
# head <hash>
```

On failure the CLI prints `FAIL first bad index <n> (line <n+1>): <reason>` and exits 1. `tamperAt(text, index)` changes one entry of an export, for the tamper demonstration.

## Hash vector

`hash` is the lowercase hex SHA-256 of the UTF-8 canonical JSON (sorted keys, no spaces, integers only) of the entry without its `hash` field. SHA-256 is pure TypeScript (`src/sha256.ts`). The same vector must come out of TypeScript and Python:

```
{"at":1788000000000,"auctionId":"01JC0000000000000000000001","cmd":"01JC0000000000000000000A01","payload":{"config":{"currency":"USD","holdScope":"event"},"title":"Spring Gala"},"prev":"0000000000000000000000000000000000000000000000000000000000000000","seq":1,"type":"AUCTION_CREATED","v":1}
hash = e1d36276c41c5b7d87c45b87dd29d4d1432dcdadced3035f1a8dfc0486045540

SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

## Fixtures

Golden fixtures live in `fixtures/golden/*.json` and are shared byte for byte with the Python reference in `reference/python`. The format is defined by `fixtures/golden/SCHEMA.json`:

```json
{
  "name": "english: bid equal to reserve is accepted",
  "parity": true,
  "config": { "mode": "english", "reserve": 1000, "minIncrement": 100, "endTs": 100000 },
  "steps": [
    { "op": "register", "at": 0, "bidder": "a", "ceiling": 100000 },
    { "op": "bid", "at": 1000, "bidder": "a", "amount": 1000 },
    { "op": "hammer", "at": 100000 }
  ],
  "expect": {
    "winner": "a",
    "price": 1000,
    "ranking": [["a", 1000]],
    "rejects": [],
    "endsAt": 100000
  }
}
```

Step ops are `register`, `bid`, `tick`, `hammer`, `promote`, `revoke`, `complete`, `abort`, `pause`, `resume` and `extend`; every step has an integer `at`. `expect` may hold `winner`, `price`, `ranking`, `rejects` and `endsAt`. `parity: true` means the Python reference must produce the same result.

To add a fixture:

1. Copy a similar file in `fixtures/golden/` and give it a name that starts with its mode and a number.
2. Edit `config`, `steps` and `expect`, keeping money in integer cents.
3. Push. The golden test loads every file with `loadFixtures` (a malformed file fails with its name) and the Python workflow runs the files with `parity: true`.
