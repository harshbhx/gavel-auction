# Live header and wrong-judge-key checks, 9 Nov 2026

Taken on 2026-11-09 between 03:19:21 and 03:19:27 UTC with curl from the agent VM. The raw output with a timestamp per request is in [live-headers-20261109.txt](live-headers-20261109.txt). Only HEAD and GET requests were sent, plus one POST with a wrong key. Cookie, date, ETag and ray-id headers are left out of the file.

## Headers per host

Expected values come from `packages/web/public/_headers` (web), `docsite/public/_headers` (docs) and the API's own security headers.

| Host                        | HTTP                          | HSTS | nosniff | X-Frame-Options                                     | Referrer-Policy                   | Permissions-Policy | CSP header                                                    |
| --------------------------- | ----------------------------- | ---- | ------- | --------------------------------------------------- | --------------------------------- | ------------------ | ------------------------------------------------------------- |
| gavel.dualmindlab.tech      | 200                           | yes  | yes     | DENY                                                | `no-referrer`                     | yes, matches file  | `frame-ancestors 'none'` (the page CSP is the meta tag)       |
| docs.gavel.dualmindlab.tech | 200                           | yes  | yes     | DENY                                                | `strict-origin-when-cross-origin` | yes, matches file  | full policy, identical to `docsite/public/_headers`           |
| api.gavel.dualmindlab.tech  | 404 on `/`, 200 on `/healthz` | yes  | yes     | not sent (the CSP carries `frame-ancestors 'none'`) | `no-referrer`                     | yes                | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` |

HSTS on all three: `max-age=31536000; includeSubDomains`. The web and docs values match the `_headers` files line by line. The web page also carries the meta tag CSP in its HTML (read from the GET body, 4479 bytes).

## Cloudflare-injected script

The HTML of both custom domains contains one Cloudflare-injected script reference, `/cdn-cgi/challenge-platform/scripts/precursor/main.js` (same origin, so allowed by `script-src 'self'` in both policies). No `cloudflareinsights` beacon was found. Not checked: whether a browser runs or blocks it under each CSP.

## Wrong judge key

At 2026-11-09 03:19:23 UTC one `POST https://api.gavel.dualmindlab.tech/api/judge/rooms` with `x-judge-key: wrong-key-evidence-check` and body `{}` answered `401` with `{"error":"judge_key_invalid","message":"That key was not accepted."}`, `cache-control: no-store`, and the same security headers as above. One request only: the five-strike lockout was not exercised, and no right key was sent. An earlier single wrong-key request from the same VM was made on 9 Nov by another check, so this address hash may hold two strikes of five for up to 15 minutes from each.

## Not checked

- The workers.dev hosts (the web host was last read on 2026-11-07, see SEC-17).
- A browser run of `network.spec.ts` against any live host (SEC-10).
- The lockout after five strikes, and a locked-out address refused with the right key.
- Repeatability: this is a one-off, not a scheduled workflow.
