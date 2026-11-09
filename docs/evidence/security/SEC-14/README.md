# SEC-14 proxy hops on the Render API: probe result

Issues #2067 and #2069. The procedure, and what each outcome proves, is in [../SEC-14-source-probe.md](../SEC-14-source-probe.md).

## The result in one line

Behind the proxies in front of the Render API the right setting is `TRUSTED_PROXY_HOPS=2`. With 1 the server logged addresses that matched neither probe runner; with 2 the logged address matched each runner exactly, for two runners, once.

## What the probe is

Workflow `sec14-source-probe` (dispatch only, confirmation text `CREATE-TWO-ROOMS`) runs two jobs on two different GitHub runners. Each reads its own public address, computes the tag `sha256(address)[0:12]`, reads the `/healthz` headers, and sends one `POST /api/judge/rooms` to the API. The server writes the address it derived as `src` (the same 12-character tag) in the audit line `judge_room.created`. If `src` equals the runner's own tag, the server sees the real client address.

## Runs

| Run                                                                               | `TRUSTED_PROXY_HOPS` | Runner | Egress address (job summary) | Expected tag   | Cloudflare data centre | HTTP | Render `src`   | Match |
| --------------------------------------------------------------------------------- | -------------------- | ------ | ---------------------------- | -------------- | ---------------------- | ---- | -------------- | ----- |
| [42564773281](https://github.com/harshbhx/gavel-auction/actions/runs/42564773281) | 1 (old)              | a      | 128.85.152.195               | `20b205d26b38` | IAD                    | 201  | `3f86d59cc425` | no    |
| same                                                                              | 1 (old)              | b      | 52.232.197.24                | `39c852f8947b` | IAD                    | 201  | `5a46afc6ca13` | no    |
| [42578306983](https://github.com/harshbhx/gavel-auction/actions/runs/42578306983) | 2 (new)              | a      | 20.55.213.123                | `8692d2ad411a` | IAD                    | 201  | `8692d2ad411a` | yes   |
| same                                                                              | 2 (new)              | b      | 52.233.94.82                 | `8a4d2cf432c0` | SEA                    | 201  | `8a4d2cf432c0` | yes   |

The address, tag, data centre and HTTP status columns come from the job summaries of the two runs (read again from the run logs). The `src` column comes from the Render logs and is quoted in [render-log-src.txt](render-log-src.txt); those logs are not in the repository, so that column cannot be re-checked from here. The probe workflow wrote no artifact.

## Reading

API traffic passes Render's own Cloudflare edge and then Render's proxy before it reaches the app. The `X-Forwarded-For` list then ends with the client address followed by one edge address, so the client is `list[length - 2]` and the right setting is 2. With 1 the server took the edge address, which is shared by many clients.

A request that sends its own `X-Forwarded-For` header adds entries on the left of the list. The server counts from the right (`sourceOf` in `packages/server/src/http/webhook.ts`), so extra left entries do not move the chosen entry while the same proxies append the same entries. When the list is shorter than the hop count the server falls back to the socket address. Not tested: a request path that skips one of the proxies (for example a direct call to the `onrender.com` address), and a probe through the Render address instead of the custom domain.

## Limits

One probe on 9 Nov 2026 with two runners and the data centres IAD and SEA, one room each. It proves the setting for those paths, not for every client. It does not make SEC-14 a PASS: the denial-of-service row has other residuals.

## How to repeat it

Dispatch `sec14-source-probe` on `main`, type `CREATE-TWO-ROOMS`, then compare the two `src` values of `judge_room.created` in the Render logs with the two expected tags printed in the job summaries. Run it again after any change of the hosting chain (a new proxy, a new CDN, a changed Render plan), and stop at any mismatch.
