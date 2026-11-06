# Web contract for holds

Schemas live in `src/contract/web.ts`; one example per message is in `src/contract/fixtures/`. The server route handlers and the web client both import the schemas. The HTTP contract below is fixed and does not depend on SDK details.

## Endpoints

```
POST /api/holds
  request : { auctionId, ceilingCents }                   CreateHoldRequest
  response: { holdId, orderId, clientToken? }            CreateHoldResponse
  errors  : 400 ceiling_out_of_range | 409 hold_exists
            503 paypal_unavailable | 503 kill_switch_engaged | 503 payments_not_sandbox

POST /api/holds/{holdId}/approve
  request : { orderId }                                  ApproveHoldRequest
  response: { holdId, status: "HELD", ceilingCents }     ApproveHoldResponse
  errors  : 404 order_not_found | 409 order_not_approved | 503 paypal_unavailable

DELETE /api/holds/{holdId}        (browser onCancel / onError; only an unapproved hold is released: PayPal is asked for a live authorization first and it is voided; a hold that is already authorized or captured answers 409 hold_exists)
```

Every error response has the body `{ "error": <code> }` (`HoldErrorResponse`). Codes: `ceiling_out_of_range`, `hold_exists`, `order_not_found`, `order_not_approved`, `paypal_unavailable`, `kill_switch_engaged`, `payments_not_sandbox`.

The server never trusts an `authId`, an amount or a bidder id from the browser. `CreateHoldRequest` has no `bidderId`: the bidder is derived from the authenticated session, and a body that names one is rejected by the strict schema.

Ownership: `approve` and `DELETE` act only on a hold whose `bidderId` equals the session bidder (`holdOwnedBySession`). A mismatch is answered exactly like an unknown hold, `404 order_not_found`, so a guessed or leaked `holdId` reveals nothing and cannot be used by another viewer.

The amount sent to PayPal is computed server-side from the validated `ceilingCents`.

## Browser sequence

```
web                         server                       PayPal
 | POST /api/holds ---------->| createOrder(AUTHORIZE) ---->|
 |<-- {orderId} --------------|<-- order CREATED -----------|
 | SDK v6 session.start(orderId) -----------------------> buyer approves
 |<-- onApprove(orderId) ------------------------------------|
 | POST /api/holds/:id/approve>| authorizeOrder ----------->|
 |<-- {status:HELD} ----------|<-- authorization CREATED ---|
```

## SDK v6 notes: VERIFIED (G2)

Exercised in the sandbox by gate G2 on 2026-11-05 (wallet and guest card both authorized; `docs/GATES.md`). The page that ran is `packages/payments/gates/g2/index.html`.

- client token acquisition (`clientToken` in the create response is opaque); the token request leaves out `domains[]` on localhost, where the sandbox answers 401 `invalid_domain`
- `findEligibleMethods` with `isEligible('paypal')` for the wallet; guest card has no eligibility key (`isEligible('basic_card')` throws "unsupported funding source")
- `createPayPalOneTimePaymentSession` (wallet) and `createPayPalGuestOneTimePaymentSession` (guest card, `paypal-basic-card-button` inside `paypal-basic-card-container`)
- `presentationMode: 'auto'`, with the pending order passed to `start()` inside the click so the popup is not blocked
- callback `onApprove`; `onCancel` and `onError` were wired but only cancel was seen

Fallback: PayPal wallet buyers only (sandbox personal accounts). With the fallback the server contract does not change; the web client simply does not advertise guest card checkout.
