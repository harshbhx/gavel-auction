# G4 webhook receiver

A small Cloudflare Worker that logs each PayPal sandbox webhook delivery untouched, so gate G4
(`packages/payments/gates/g4.ts`) can verify and compare real events.

| Route                           | Effect                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `POST /hook`                    | Stores `{headers, rawBody, receivedAt}` (header names lower-cased, body as received, at most 256 KB). Entries expire after 7 days. |
| `GET /log?token=<LOG_TOKEN>`    | JSONL, one `{"headers":{...},"rawBody":"..."}` per delivery, oldest first.                                                         |
| `DELETE /log?token=<LOG_TOKEN>` | Clears the log.                                                                                                                    |

Anything else answers 404 or 405. Without a valid token `/log` answers 401.

## Deploy

```sh
export CLOUDFLARE_ACCOUNT_ID=<account id>
cd tools/g4-receiver
npx wrangler@4 kv namespace create gavel-g4-log   # put the id in wrangler.toml
openssl rand -hex 24 | npx wrangler@4 secret put LOG_TOKEN
npx wrangler@4 deploy
```

Set the webhook URL of the sandbox app to `https://gavel-g4-receiver.<subdomain>.workers.dev/hook`
and keep `LOG_TOKEN` in the `G4_LOG_TOKEN` Actions secret. The `gate-g4` workflow produces the
events, waits for the deliveries, fetches the log and runs the gate.
