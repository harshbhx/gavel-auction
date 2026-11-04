# Mounting the auction service (RT-9N)

The composition root is `createAuctionService(deps)` in `packages/server/src/runtime/`. It has no routes and no sockets. The HTTP and WebSocket host (RT-70, RT-72) builds it once at start-up and mounts four things.

## Build it

Pass ports only: the room `store`, `clock`, `ids`, the engine `ledger` store, the payments `journals`, `holds` and `webhookEvents` stores, an `audit` sink, the PayPal `gateway`, and a webhook `verifier`. Production passes the durable stores and the HTTP gateway; tests pass the memory stores and the fake PayPal server. Call `service.resume()` once at start-up and again on a timer (every 30 seconds is enough): it loads every room, continues settlements that stopped, and applies stored webhook events that were not applied yet.

## Mount points

- WebSocket connect: verify the token, then `const room = await service.room(auctionId)` and `room.attach({ id, role, bidderId, sub, transport })`. Route frames to `room.submitBid(conn, msg)` and `room.control(conn, cmd)`. On close call `room.detach(conn.id)`.
- Create auction (auctioneer HTTP route): `service.createAuction(auctionId, config, auctioneerSub)`. The config is checked against `AuctionConfigSchema`.
- Hold approved (HTTP route that calls `HoldService.completeApproval`): then `service.registerBidder({ auctionId, bidderId, name, holdId })`. It refuses a hold that is not HELD or belongs to someone else, and takes the ceiling from the hold.
- PayPal webhook route: read the raw body bytes (no JSON parser in front), then `const { status } = await service.handleWebhook(rawBody, req.headers)` and answer with that status. 200 means stored, 401 means the signature failed, 503 asks PayPal to send it again.

## What happens after the hammer

The room calls the service's settle port when the hammer is persisted. The call returns at once; a background run then does, in order:

1. Replays the room engine's commands into the engine runtime, which writes the hash-chained ledger.
2. Plans the settlement from the engine's candidates and the HELD holds, and tells the engine about leaders that cannot be charged (`SettlementBridge.prepare`).
3. Creates the settlement journal, runs the capture phase, then the void phase for every other hold.
4. Records the saga history in the engine, completes the lot and closes the auction.
5. Reports progress with `Room.reportSettlement`. The terminal report is sent only after step 4, so a room that is DONE always has an engine ledger that agrees.

Every step is safe to repeat. A crash at any point is continued by `resume()` or by loading the room: PayPal calls reuse their request ids and the capture phase adopts a capture it finds on the authorization, so there is never a second capture.

## Notes for the host

- Do not await the settle port from the room's mailbox; the service never does.
- `boundary` and `onError` in the deps are for tests and logging; leave them unset or point `onError` at the logger.
- Holds voided or denied while bidding are noticed at settlement (the plan skips them and the engine promotes the next bidder). A bidder is not struck from the live bidding when that happens.
