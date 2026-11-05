# Sandbox response fixtures

Redacted responses of the real PayPal sandbox, plus the redacted webhook events in
`packages/e2e/fixtures/webhooks/`. Ids are placeholders: `{{ORDER_ID}}`, `{{AUTH_ID}}`,
`{{CAPTURE_ID}}`, `{{EVENT_ID}}` and `{{DEBUG_ID}}`. Tests put synthetic ids in before they parse
a file. Each response file is `{ "status": <http status>, "body": <json> }`.

## How each was captured

| File                                    | Gate step     | Call                                                   |
| --------------------------------------- | ------------- | ------------------------------------------------------ |
| `order-created.json`                    | G1.1          | POST /v2/checkout/orders (AUTHORIZE, 500.00 USD)       |
| `order-approved.json`                   | G1.2          | GET the order after the buyer approved it              |
| `order-authorized.json`                 | G1.3          | POST the order's /authorize                            |
| `authorization-created.json`            | G1.4          | GET /v2/payments/authorizations/{id}                   |
| `capture-final.json`                    | G1.5          | POST /capture, 350.00, final_capture=true              |
| `authorization-after-capture.json`      | G1.6          | GET the authorization after the final capture          |
| `order-after-capture.json`              | G1.6          | GET the order after the final capture                  |
| `void-rejected.json`                    | G1.7          | POST /void on the captured authorization (422)         |
| `authorization-after-void-attempt.json` | G1.8          | GET the authorization after the rejected void          |
| webhook events (six files)              | G4.1 and G4.2 | real deliveries to the G4 listener, signature verified |

The G1 run is `docs/evidence/G1/G1-20261104T231047Z.jsonl` and the G4 run is
`docs/evidence/G4/G4-20261105T012205Z.jsonl`. The gate scripts already replace secrets with
`[REDACTED]` when they write evidence. `redact.mjs` then swaps the ids for placeholders and stops
when a file still matches a token pattern (bearer or basic credentials, access tokens, client
secrets, query tokens, email addresses).

## Rebuild or check

```
node packages/payments/fixtures/sandbox/redact.mjs docs/evidence/G1/G1-20261104T231047Z.jsonl \
  packages/payments/test/fixtures/webhooks
node packages/payments/fixtures/sandbox/redact.mjs <evidence> <webhook dir> --check
```

`packages/payments/test/sandbox-fixtures.test.ts` checks for token substrings and parses each file
with the real orders and payments clients and the webhook intake.
