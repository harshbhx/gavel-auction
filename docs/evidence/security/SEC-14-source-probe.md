# SEC-14 source-address probe: how to read it and what each outcome proves

Issues: #2067 and #2069. Status of SEC-14 stays as it is in `docs/SECURITY-REVIEW.md` until a run below is recorded.

## Why this is a procedure and not an automatic check

The API has no route that echoes the client address, and a production route must not be added for this. The address the server derives (`sourceOf` in `packages/server/src/http/webhook.ts`, `list[length - TRUSTED_PROXY_HOPS]` of `X-Forwarded-For`) is used for the rate limits and lockouts and is never returned to the caller. The only place it is written down is the audit log: the public judge-room create route writes the line `judge room created` with `event: judge_room.created` and a field `src` that holds the first 12 hex characters of `sha256(clientKey(address))` (`sourceTag` in `packages/server/src/http/code-guard.ts`). For an IPv4 address `clientKey` is the address itself, so the tag is `sha256(address)[0:12]`.

That gives a safe comparison. If the server sees a client's own address, the tag in the log equals the tag computed from that client's public address. If it sees a shared Cloudflare edge address, the tags of two different clients are equal to each other and to neither client's own tag.

## Two proxy hops are likely

Responses from the API host carry `server: cloudflare` and `cf-ray`, and `x-render-origin-server: Render`. The custom domain is proxied by Cloudflare, and Render itself also fronts its services with Cloudflare, so there may be two proxy hops in front of the app while `TRUSTED_PROXY_HOPS` is 1. The first probe run (sec14-source-probe run 42564773281) created both rooms with HTTP 201; the `src` values in the Render logs have still to be compared.

## The probe

Workflow `sec14-source-probe` (dispatch only; type `CREATE-TWO-ROOMS`). It runs two jobs, `a` and `b`, on two different runners, 45 seconds apart. Each job:

1. reads its own public IPv4 address from `api.ipify.org`;
2. computes `sha256(address)[0:12]`;
3. reads `/healthz` headers (which Cloudflare data centre it reached, and that both `server: cloudflare` and `x-render-origin-server: Render` are present);
4. sends one `POST /api/judge/rooms` with an empty body to the live API;
5. prints the address, the expected tag, the time and the HTTP status in the job summary.

Side effects: two short-lived sandbox judge rooms that the server sweeps at their lifetime, and one use of the per-address hourly create budget (`JUDGE_ROOMS_PER_IP_HOUR`, default 12) for each runner. No limit is exhausted and no wrong code or key is sent, so no lockout can start. The response body, tokens and join codes are not printed or stored.

A second egress that is not a runner (for example the operator's own machine) can be added by hand: `curl -s -X POST https://api.gavel.dualmindlab.tech/api/judge/rooms -H 'content-type: application/json' --data '{}' -o /dev/null -w '%{http_code}\n'` and `printf '%s' "$(curl -s https://api.ipify.org)" | sha256sum | cut -c1-12`.

## Reading the logged address in Render

1. Render dashboard, service `gavel-host`, Logs. Set the time range to cover the two job times printed in the summaries.
2. Filter on `judge_room.created`. Each line carries `src`, `via: public` and a timestamp. Match the lines to the jobs by timestamp (the two jobs are 45 seconds apart).
3. Copy the two `src` values next to the two expected tags from the job summaries.

If a 429 or 404 was the answer instead of 201, there is no `judge_room.created` line for that job. A 404 means judge rooms are off on that host; then use another audited route, or ask the operator to run with `JUDGE_ROOMS=true` on a staging service. Do not repeat the request in a loop.

## What each outcome proves

- Each `src` equals the expected tag of its own runner: the server sees the real client address. `TRUSTED_PROXY_HOPS=1` is right for the live chain, per-address limits are per client, and #2067 and #2069 are closed with the two pairs of tags as evidence.
- The two `src` values are equal to each other and differ from both expected tags: the server sees one shared address, the Cloudflare edge Render saw. Every per-address limit and the join and judge-key lockouts act on that shared address for all clients behind it. This confirms the issue. The fix in the issues applies: read `CF-Connecting-IP` when the request came through Cloudflare, or set the hop count to the measured chain, then repeat this probe.
- The two `src` values differ from each other but neither equals its expected tag: the server sees per-client addresses that are not the runners' public ones (for example a second proxy that rewrites them). Limits are per client, but the hop count and the chain are not what the docs say, so SEC-14 should be re-read with the raw `x-forwarded-for` chain (operator only, never posted).
- A runner's expected tag cannot be computed (IPv6 egress): the job stops with an error; compute the tag with `clientKey` from `packages/shared/src/client-key.ts` instead.

A run proves the setting only for the two runners and the Cloudflare data centres they reached. Record the run URL, the two expected tags, the two logged tags and the data centre codes in the same file as the verdict.
