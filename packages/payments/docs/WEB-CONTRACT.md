# Web contract for holds

Schemas live in `src/contract/web.ts`; one example per message is in `src/contract/fixtures/`. The server route handlers and the web client both import the schemas. The HTTP contract below is fixed and does not depend on SDK details.

## Endpoints

```
POST /api/holds
  request : { auctionId, bidderId, ceilingCents }        CreateHoldRequest
  response: { holdId, orderId, clientToken? }            CreateHoldResponse
  errors  : 400 ceiling_out_of_range | 409 hold_exists
            503 paypal_unavailable | 503 kill_switch_engaged | 503 payments_not_sandbox

POST /api/holds/{holdId}/approve
  request : { orderId }                                  ApproveHoldRequest
  response: { holdId, status: "HELD", ceilingCents }     ApproveHoldResponse
  errors  : 404 order_not_found | 409 order_not_approved | 503 paypal_unavailable

DELETE /api/holds/{holdId}        (browser onCancel / onError; no PayPal call, the order expires)
```

Every error response has the body `{ "error": <code> }` (`HoldErrorResponse`). Codes: `ceiling_out_of_range`, `hold_exists`, `order_not_found`, `order_not_approved`, `paypal_unavailable`, `kill_switch_engaged`, `payments_not_sandbox`.

The server never trusts an `authId` or amount from the browser. The amount sent to PayPal is computed server-side from the validated `ceilingCents`.

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

## SDK v6 notes: UNVERIFIED (G2)

The following names are taken from PayPal documentation and have not been exercised in the sandbox. Treat each as UNVERIFIED (G2):

- client token acquisition (`clientToken` in the create response is opaque)
- `findEligibleMethods`
- `createPayPalOneTimePaymentSession`
- `presentationMode`
- callbacks `onApprove`, `onCancel`, `onError`

Fallback: PayPal wallet buyers only (sandbox personal accounts). With the fallback the server contract does not change; the web client simply does not advertise guest card checkout.
