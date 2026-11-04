# Payments boundary: what happens after capture

Status: design note for PAY-69. It states where `packages/payments` stops. It adds no requirement and no code.

## Where the package stops

The payments package moves money in exactly three ways, all inside the PayPal sandbox:

1. Create and authorize an order, which places a hold (SPEC R-PAY-030).
2. Capture the winning hold at the clearing price (R-PAY-051).
3. Void every other hold, and the winner's open remainder if PayPal does not release it (R-PAY-059, R-PAY-062).

Once the settlement is `SETTLED` (SPEC 3.4) the package has finished its job. The winner's money is captured, every other hold is released, and the journal holds the proof. Nothing in the package acts on a capture after that point.

## Refunds

Refunds are manual in the demo. There is no refund call in the gateway port (`PaymentsGateway` has no `refund`), no refund route in the fake server, and no refund state in the settlement machine.

If a demo capture has to be returned, the operator does it by hand in the PayPal sandbox dashboard, using the capture id. The package gives the operator what is needed to find it:

- the capture id and the amount, in the journal and in the `settlement_update` payload (SPEC 5.4);
- the invoice id `gavel-<auctionId>-<holdId>` sent with the capture, so the capture is searchable on the order (R-PAY-051);
- the request id and the `PayPal-Debug-Id` of the capture call, in the audit entries and in the log (R-PAY-019, R-PAY-064).

A manual refund changes PayPal's state and not ours. The journal stays as it was, and the reconciler may report a difference (see below). That is expected, and it is not repaired automatically.

## Disputes and chargebacks

Disputes are manual in the demo as well. The package does not read, create or answer disputes, and does not call the disputes API. Sandbox buyers can open a dispute in the sandbox UI, and the operator handles it there.

## Webhook events after capture

Events about refunds and disputes, for example `PAYMENT.CAPTURE.REFUNDED` and `CUSTOMER.DISPUTE.CREATED`, are not in the handled list of R-PAY-098. Under that rule an unknown event type is stored and acknowledged with 200, and it changes no hold or settlement state. The stored row is the only trace.

Webhooks are hints and never the source of truth (R-PAY-095), so ignoring these events cannot move money or edit the journal.

## Reconciliation after a manual refund

`reconcile(auctionId)` compares the journal with what PayPal reports (R-PAY-100). After a manual refund it can show:

- `AMOUNT_MISMATCH`, when PayPal reports a captured amount that differs from the journal;
- `STATUS_DRIFT`, when the authorization status no longer matches the stored one.

The reconciler is read-only by default. Its only repair option voids live holds that remain after `SETTLED` (R-PAY-101). It never captures, never refunds and never edits the money fields of the journal. A person reads the report and decides.

## What the demo promises

- A hold is a PayPal authorization in the sandbox. No real money is involved, ever (R-PAY-002).
- A capture is final from the point of view of the software. Returning it is a manual step outside the package.
- The kill switch does not touch captured money. It blocks new orders, authorizations, captures and reauthorizations; voids and reads keep working (R-PAY-111).

## If this boundary moves

Adding refunds would need, at least: a gateway method and its fake, a refund state in the settlement machine, an idempotent request id for the refund, webhook handling for the refund events, a reconciler rule for refunded captures, and a gate that observes the real sandbox behaviour first (every PayPal behaviour here is `UNVERIFIED` until a gate has recorded it). None of that is planned for the demo.
