# Security review (R-QA-036)

Checklist SEC-01 to SEC-18 from `docs/specs/quality/SPEC-quality.md` section on security. Each item
is PASS, FAIL (with an issue link), ACCEPTED (a risk kept on purpose, with its justification and
compensating control) or N/A (with a reason). A P0 FAIL blocks submission. The reviewer
of an item is never its author. Status OPEN means nobody has signed the item off yet; the automated
check listed under Evidence is what the reviewer re-runs.

| ID     | Pri | Area                                        | Status   | Evidence (automated check)                            | Reviewer   | Date       |
| ------ | --- | ------------------------------------------- | -------- | ----------------------------------------------------- | ---------- | ---------- |
| SEC-01 | P0  | Access control on auctioneer actions        | PASS     | T-QA-070, `packages/e2e/test/security/access.test.ts` | sec-review | 2026-11-07 |
| SEC-02 | P0  | Bidder identity and token binding           | PASS     | T-QA-071, `access.test.ts`                            | sec-review | 2026-11-07 |
| SEC-03 | P0  | Webhook authenticity                        | PASS     | T-QA-072, `webhook.test.ts`                           | sec-review | 2026-11-07 |
| SEC-04 | P0  | Secrets in repo, logs and bundle            | PASS     | T-QA-073, gitleaks workflow, bundle scan              | sec-review | 2026-11-07 |
| SEC-05 | P0  | Sandbox-only guard and boot validation      | PASS     | `sandbox.test.ts`                                     | sec-review | 2026-11-07 |
| SEC-06 | P0  | Money integrity (integer cents, ledger)     | PASS     | engine and payments tests                             | sec-review | 2026-11-07 |
| SEC-07 | P0  | Injection and rendering of untrusted text   | PASS     | T-QA-074, `fuzz.test.ts`                              | sec-review | 2026-11-07 |
| SEC-08 | P1  | Abusive input caps                          | PASS     | `abuse.test.ts`                                       | sec-review | 2026-11-07 |
| SEC-09 | P1  | CORS and origin allowlist                   | PASS     | T-QA-075                                              | sec-review | 2026-11-07 |
| SEC-10 | P1  | Transport and security headers, CSP         | PASS     | T-QA-076, `headers.test.ts`, web `network.spec.ts`    | hygiene    | 2026-11-07 |
| SEC-11 | P1  | Audio and personal data                     | ACCEPTED | manual review                                         | sec-review | 2026-11-07 |
| SEC-12 | P1  | Dependency risk                             | PASS     | T-QA-077, `audit.yml`, `audit-waivers.json`           | sec-review | 2026-11-07 |
| SEC-13 | P1  | SSRF                                        | PASS     | `webhook.test.ts` (cert URL host allowlist)           | sec-review | 2026-11-07 |
| SEC-14 | P1  | Denial of service on the parse path         | PASS     | T-QA-078, `dos.test.ts`                               | sec-review | 2026-11-07 |
| SEC-15 | P2  | Logging hygiene                             | OPEN     | log scan after S01                                    |            |            |
| SEC-16 | P2  | Admin and ops pages                         | PASS     | manual review                                         | sec-review | 2026-11-07 |
| SEC-17 | P2  | Clickjacking and PayPal return URL redirect | PASS     | manual review, live header check                      | hygiene    | 2026-11-07 |
| SEC-18 | P0  | Server time is authoritative                | PASS     | T-QA-079                                              | sec-review | 2026-11-07 |
| SEC-19 | P1  | Key-less judge rooms (JUDGE_ROOMS)          | OPEN     | `http-judge-rooms.test.ts`                            |            |            |
| SEC-20 | P1  | Shareable receipt link (receipt token)      | OPEN     | `http-receipt.test.ts`, `token.test.ts`               |            |            |

## How to record a result

1. Re-run the listed check in CI or review the code named in Evidence.
2. Replace OPEN with PASS, FAIL, ACCEPTED or N/A. A FAIL needs an issue link in a Notes line below; an N/A
   needs a reason.
3. Fill in the reviewer and date. The reviewer is not the author of the code under review.

## Notes

No FAIL is recorded. Reviewed 2026-11-07 by a reviewer who did not write the code under
review, from the code, the CI runs named below and read-only GETs of the live hosts. A human second
look at the P0 rows is still advisable before the final submission.

## Evidence by item

- **SEC-01** PASS. T-QA-070 `access.test.ts` (role matrix, forbidden hammer, bid under token identity) and the deny-by-default table in `auth/authorize.ts`. Live GETs of `/ops/rooms`, `/metrics` and `/admin/export` answer 401 without the key. [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490) on 1bd4abfa.
- **SEC-02** PASS. T-QA-071 `access.test.ts` (audience, subject, kind, forgery, expiry, revoke, replay, fail closed when the revocation store throws); `auth/token.ts`, `auth/rotation.ts`. [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-03** PASS. T-QA-072 `webhook.test.ts`: PayPal verify call decides, 400 for a missing, tampered or foreign signature, 413 over 256 KiB before verification, replay filter and event dedupe. [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-04** PASS. gitleaks history workflow green on main; `check:secrets` and the bundle canary scan run in the ci secrets job; log redaction by key and by pattern in `log/logger.ts` (`logger.test.ts`). The live web bundle was fetched and searched for secret names and key markers: none.
- **SEC-05** PASS. `sandbox.test.ts` (live hosts refused, `PAYPAL_ENV` must be sandbox, CI grep for live hosts); `config/validate.ts` exits 78; the web build refuses without `VITE_SANDBOX=true`. [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-06** PASS. Amounts are integer cents end to end: no float arithmetic in engine, payments or server source (the one percentage floors). Engine property tests and payments ledger tests run in [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-07** PASS. T-QA-074 `fuzz.test.ts`; `abuse.test.ts` keeps script text as data and out of public frames. No `innerHTML`, `dangerouslySetInnerHTML` or `eval` in web or server source, React escapes names, CSP `script-src` is self plus the PayPal sandbox.
- **SEC-08** PASS. `abuse.test.ts` (wire limits, hostile amounts, 200 bids per second flood) and room caps in `limits/caps.ts`, in the ci unit job.
- **SEC-09** PASS. `host/node-ws.ts` and `host/audio-ws.ts` refuse an upgrade without an allowlisted Origin (403); HTTP echoes only `CORS_ORIGINS` and a preflight from another origin is 403 (`http-app.test.ts`). Live: a request with an evil Origin gets no allow-origin header.
- **SEC-10** PASS. API: CSP, HSTS, nosniff and referrer policy on every response (live curl, `http-security-headers.test.ts`). Web Worker headers come from `packages/web/public/_headers` (PR #1961). live `curl -sI https://gavel-web.creharsh.workers.dev/` on 2026-11-07 showed `strict-transport-security: max-age=31536000; includeSubDomains`, `content-security-policy: frame-ancestors 'none'`, `permissions-policy: camera=(), geolocation=(), microphone=(self), usb=()`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, and `cache-control: public, max-age=31536000, immutable` on a hashed asset (`/assets/index-*.js`). The page CSP that limits scripts and connections is the meta tag in `index.html`; the header carries `frame-ancestors` only, because that directive is ignored in a meta tag. Docs host: `docsite/public/_headers` sets the same set (HSTS, nosniff, `strict-origin-when-cross-origin`, permissions policy, `X-Frame-Options`) plus a CSP with `frame-ancestors 'none'` that allows the inline scripts of the Next static export; the `docsite` workflow checks that `_headers` reaches the export and the screenshots job runs every page under that CSP and fails on a violation. The deploy to the custom domain is done by the operator, so the live docs host shows the headers only after that redeploy. Not checked: a browser run of `network.spec.ts` against the live host.
- **SEC-11** ACCEPTED. `docs/PRIVACY.md`: audio is streamed to the speech vendor and not stored here, names are stored with the auction, chatter transcripts are redacted. Accepted risk: vendor retention terms are unverified. Compensating control: sandbox-only notice in the voice README and the privacy page.
- **SEC-12** PASS. `audit.yml` green on main; every waiver in `audit-waivers.json` has a reason and expires 2027-02-01; the waived advisories are dev and test tooling that the esbuild bundle of the API does not ship.
- **SEC-13** PASS. `payments/src/webhooks/verify.ts` trusts only an https certificate URL on `paypal.com` or a subdomain, without userinfo (`webhook.test.ts`). The server never fetches a client-supplied URL.
- **SEC-14** PASS. T-QA-078 `dos.test.ts` (hanging model gives way to rules, the 61st call per minute is limited), 8 KiB audio frames, body limits in `http/app.ts`. Residual: `TRUSTED_PROXY_HOPS=1` in `render.yaml` may bucket by the proxy address instead of the client; not confirmed against the live host.
- **SEC-15** OPEN. Redaction is unit tested (`logger.test.ts`); the log scan after scenario S01 has not been run.
- **SEC-16** PASS. `/ops/*`, `/metrics` and `/admin/*` need `x-admin-key` (constant-time compare, 24 character minimum, must differ from the token secret). Live GETs answer 401. No HTML admin page is served.
- **SEC-17** PASS. API sends `frame-ancestors 'none'`; no server redirect takes a client URL (return URLs are fixed in the PayPal SDK flow). The web host answers with `content-security-policy: frame-ancestors 'none'` and `x-frame-options: DENY` (live `curl -sI https://gavel-web.creharsh.workers.dev/` on 2026-11-07).
- **SEC-18** PASS. T-QA-079 `access.test.ts` (events carry the server clock whatever `clientTs` says). [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-19** OPEN (new, not yet reviewed by someone other than its author). Threat: a create route that needs no operator key (`POST /api/judge/rooms`) lets anyone on the internet open real sandbox rooms, so it could be used to exhaust the host, to mint a token that reaches operator routes, to leave rooms running, or to point real PayPal at an unattended endpoint. Mitigations: the route answers 404 unless `JUDGE_ROOMS=true`; boot validation refuses the flag with a non-sandbox `PAYPAL_ENV` or `PAYPAL_BASE_URL` and, on a production-like host, without `PAYMENTS=sandbox`; `DEMO_MODE` stays refused in production; per-address and host-wide hourly create limits (the address is stored only as a short hash); a cap on live rooms counted before the first await so a burst cannot overshoot it; a fixed safe lot (small reserve, short window, ceilings under the payments cap); the response carries room-scoped auctioneer and screen tokens only, which every admin route rejects (they need `x-admin-key`); a sweeper ends each room at its lifetime, voids unsettled holds through the normal abort path and revokes the creator token; every audit line carries `judgeRoom: true`; the operator can switch creation off at runtime with `POST /api/judge/pause` (admin key) or boot paused with `JUDGE_ROOMS_PAUSED=true`. Residual: judges behind one shared address share the per-address limit (`JUDGE_ROOMS_PER_IP_HOUR`); an attacker with many addresses can fill the room cap and block judges until rooms expire; the real sandbox path (hold, hammer, void) is covered by the fake PayPal in CI and by a sandbox spec that is skipped without secrets.
- **SEC-20** OPEN (new, not yet reviewed by someone other than its author). Threat: a receipt link is passed around, so whatever its token opens is opened for whoever holds it. Mitigations: the token is its own kind (`receipt`) with a four hour lifetime equal to the bidder session; it names one bidder in `sub` and carries no `bidderId`, so every route that wants a session, screen or auctioneer token refuses it and the socket join refuses it; it opens exactly one read-only route, `GET /api/auctions/:id/receipt`, which refuses every other kind; it is minted only by `POST /api/auctions/:id/receipt-link` from that bidder's own session token; the response is the bidder snapshot cut down to the lot title, the hammer outcome, the holder's own roster row (display name and paddle), the winner's paddle without a name and the holder's own hold (no other bidder, no audit rows, no join code, no ceiling object); the token rides in the URL fragment, which the browser never sends to a server or a log and the app removes from the address bar after reading it. Tests: `http-receipt.test.ts` (scoping, expiry, tampering, wrong audience, wrong kind, redaction), `token.test.ts`. Residual: a copied link works until it expires and cannot be revoked one by one (the same as a session token); the QR code and the printed page carry the link.

## Sign-off

Submission is allowed when no P0 item is FAIL or OPEN. All eight P0 items (SEC-01 to SEC-07 and
SEC-18) are PASS as of 2026-11-07.
