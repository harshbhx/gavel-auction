# G4 webhook receiver

A small Cloudflare Worker that logs each PayPal sandbox webhook delivery untouched, so gate G4
(`packages/payments/gates/g4.ts`) can verify and compare real events.

| Route                           | Effect                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /hook`                    | Stores `{headers, rawBody, receivedAt}` (header names lower-cased, body as received, at most 256 KB) only when the request has the PayPal transmission headers, a JSON content type and a body with `id` and `event_type`; otherwise 400. Client address headers are dropped. At most 40 entries are kept (429 beyond that) and entries expire after 2 days. |
| `GET /log?token=<LOG_TOKEN>`    | JSONL, one `{"headers":{...},"rawBody":"..."}` per delivery, oldest first.                                                                                                                                                                                                                                                                                   |
| `DELETE /log?token=<LOG_TOKEN>` | Clears the log.                                                                                                                                                                                                                                                                                                                                              |

`GET` and `DELETE` handle at most 40 entries per request; `DELETE` answers `cleared <n> more <0|1>` and
should be repeated while it says `more 1`.

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
