# Security review (R-QA-036)

Checklist SEC-01 to SEC-24 from `docs/specs/quality/SPEC-quality.md` section on security. Each item
is PASS, PARTIAL (the check passes and a named residual is still open), FAIL (with an issue link), ACCEPTED (a risk kept on purpose, with its justification and
compensating control) or N/A (with a reason). A P0 FAIL or OPEN blocks submission. The reviewer
of an item is never its author. Status OPEN means nobody has signed the item off yet; the automated
check listed under Evidence is what the reviewer re-runs.

| ID     | Pri | Area                                        | Status   | Evidence (automated check)                                                                      | Reviewer   | Date       |
| ------ | --- | ------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- | ---------- | ---------- |
| SEC-01 | P0  | Access control on auctioneer actions        | PASS     | T-QA-070, `packages/e2e/test/security/access.test.ts`                                           | sec-review | 2026-11-07 |
| SEC-02 | P0  | Bidder identity and token binding           | PASS     | T-QA-071, `access.test.ts`                                                                      | sec-review | 2026-11-07 |
| SEC-03 | P0  | Webhook authenticity                        | PASS     | T-QA-072, `webhook.test.ts`                                                                     | sec-review | 2026-11-07 |
| SEC-04 | P0  | Secrets in repo, logs and bundle            | PASS     | T-QA-073, gitleaks workflow, bundle scan                                                        | sec-review | 2026-11-07 |
| SEC-05 | P0  | Sandbox-only guard and boot validation      | PASS     | `sandbox.test.ts`                                                                               | sec-review | 2026-11-07 |
| SEC-06 | P0  | Money integrity (integer cents, ledger)     | PASS     | engine and payments tests                                                                       | sec-review | 2026-11-07 |
| SEC-07 | P0  | Injection and rendering of untrusted text   | PASS     | T-QA-074, `fuzz.test.ts`                                                                        | sec-review | 2026-11-07 |
| SEC-08 | P1  | Abusive input caps                          | PASS     | `abuse.test.ts`                                                                                 | sec-review | 2026-11-07 |
| SEC-09 | P1  | CORS and origin allowlist                   | PARTIAL  | T-QA-075                                                                                        | sec-review | 2026-11-07 |
| SEC-10 | P1  | Transport and security headers, CSP         | PARTIAL  | T-QA-076, `headers.test.ts`, web `network.spec.ts`                                              | hygiene    | 2026-11-07 |
| SEC-11 | P1  | Audio and personal data                     | ACCEPTED | manual review                                                                                   | sec-review | 2026-11-07 |
| SEC-12 | P1  | Dependency risk                             | PASS     | T-QA-077, `audit.yml`, `audit-waivers.json`                                                     | sec-review | 2026-11-07 |
| SEC-13 | P1  | SSRF                                        | PASS     | `webhook.test.ts` (cert URL host allowlist)                                                     | sec-review | 2026-11-07 |
| SEC-14 | P1  | Denial of service on the parse path         | PARTIAL  | T-QA-078, `dos.test.ts`                                                                         | sec-review | 2026-11-07 |
| SEC-15 | P2  | Logging hygiene                             | PARTIAL  | log scan after S01, `docs/evidence/security/SEC-15/`                                            | agent-only | 2026-11-09 |
| SEC-16 | P2  | Admin and ops pages                         | PASS     | manual review                                                                                   | sec-review | 2026-11-07 |
| SEC-17 | P2  | Clickjacking and PayPal return URL redirect | PASS     | manual review, live header check                                                                | hygiene    | 2026-11-07 |
| SEC-18 | P0  | Server time is authoritative                | PASS     | T-QA-079                                                                                        | sec-review | 2026-11-07 |
| SEC-19 | P1  | Key-less judge rooms (JUDGE_ROOMS)          | OPEN     | `http-judge-rooms.test.ts`                                                                      | agent-only | 2026-11-09 |
| SEC-20 | P1  | Shareable receipt link (receipt token)      | OPEN     | `http-receipt.test.ts`, `token.test.ts`                                                         | agent-only | 2026-11-09 |
| SEC-21 | P1  | Judge key and lockout (`x-judge-key`)       | PARTIAL  | `http-judge-key.test.ts`, `config-judge-key.test.ts`                                            | agent-only | 2026-11-09 |
| SEC-22 | P1  | Reviewer token and ledger route             | PARTIAL  | `http-judge-key.test.ts`, `token.test.ts`                                                       | agent-only | 2026-11-09 |
| SEC-23 | P1  | Simulated holds in judge rooms              | PARTIAL  | `http-judge-sim-hold.test.ts`, `sim-holds.test.ts`                                              | agent-only | 2026-11-09 |
| SEC-24 | P2  | Docs host and custom-domain headers         | PARTIAL  | `docsite/public/_headers`, `docsite` workflow, `docs/evidence/security/live-checks-20261109.md` | agent-only | 2026-11-09 |

## How to record a result

1. Re-run the listed check in CI or review the code named in Evidence.
2. Replace OPEN with PASS, PARTIAL, FAIL, ACCEPTED or N/A. A FAIL needs an issue link in a Notes line below; an N/A
   needs a reason.
3. Fill in the reviewer and date. The reviewer is not the author of the code under review.

## Notes

No row is recorded as FAIL. Rows SEC-19 and SEC-20 are OPEN, and SEC-09, SEC-10, SEC-14, SEC-15 and SEC-21 to SEC-24 are PARTIAL, each with its residual in the evidence below. Rows SEC-01 to SEC-18 were reviewed 2026-11-07 by a reviewer who did not write the code under
review, from the code, the CI runs named below and read-only GETs of the live hosts. Rows SEC-21 to SEC-23 cover judge-room features added on 2026-11-08 and 2026-11-09; they were checked against the code and the tests named in each row, and the live host reports the features through `GET /api/judge/capabilities` (checked 2026-11-09: `judgeRooms`, `simHolds` and `keyed` all true). A human second look at the P0 rows is still advisable before the final submission.

## Evidence by item

- **SEC-01** PASS. T-QA-070 `access.test.ts` (role matrix, forbidden hammer, bid under token identity) and the deny-by-default table in `auth/authorize.ts`. Live GETs of `/ops/rooms`, `/metrics` and `/admin/export` answer 401 without the key. [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490) on 1bd4abfa.
- **SEC-02** PASS. T-QA-071 `access.test.ts` (audience, subject, kind, forgery, expiry, revoke, replay, fail closed when the revocation store throws); `auth/token.ts`, `auth/rotation.ts`. [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-03** PASS. T-QA-072 `webhook.test.ts`: PayPal verify call decides, 400 for a missing, tampered or foreign signature, 413 over 256 KiB before verification, replay filter and event dedupe. [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-04** PASS. gitleaks history workflow green on main; `check:secrets` and the bundle canary scan run in the ci secrets job; log redaction by key and by pattern in `log/logger.ts` (`logger.test.ts`). The live web bundle was fetched and searched for secret names and key markers: none.
- **SEC-05** PASS. `sandbox.test.ts` (live hosts refused, `PAYPAL_ENV` must be sandbox, CI grep for live hosts); `config/validate.ts` exits 78; the web build refuses without `VITE_SANDBOX=true`. [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-06** PASS. Amounts are integer cents end to end: no float arithmetic in engine, payments or server source (the one percentage floors). Engine property tests and payments ledger tests run in [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-07** PASS. T-QA-074 `fuzz.test.ts`; `abuse.test.ts` keeps script text as data and out of public frames. No `innerHTML`, `dangerouslySetInnerHTML` or `eval` in web or server source, React escapes names, CSP `script-src` is self plus the PayPal sandbox.
- **SEC-08** PASS. `abuse.test.ts` (wire limits, hostile amounts, 200 bids per second flood) and room caps in `limits/caps.ts`, in the ci unit job.
- **SEC-09** PARTIAL. `host/node-ws.ts` and `host/audio-ws.ts` refuse an upgrade without an allowlisted Origin (403); HTTP echoes only `CORS_ORIGINS` and a preflight from another origin is 403 (`http-app.test.ts`). Live: a request with an evil Origin gets no allow-origin header. Since #2061 a POST, PUT, PATCH or DELETE that carries an Origin outside `CORS_ORIGINS`, `WEB_ORIGIN` and the API's own origin (one normalised list shared by the write check, the CORS headers and the socket upgrade, `http/origins.ts`) is answered 403 before any handler runs (`http-app.test.ts`); requests without an Origin (curl, PayPal webhooks, health checks, scripts) are unchanged, and a GET is not refused (the browser withholds the response without the allow-origin header). Residual: a non-browser client can forge or omit the header, so tokens and the admin key stay the real control. Not reviewed here: the behaviour of every route for a cross-origin request.
- **SEC-10** PARTIAL. API: CSP, HSTS, nosniff and referrer policy on every response (live curl, `http-security-headers.test.ts`). Web Worker headers come from `packages/web/public/_headers` (PR #1961). live `curl -sI https://gavel-web.creharsh.workers.dev/` on 2026-11-07 showed `strict-transport-security: max-age=31536000; includeSubDomains`, `content-security-policy: frame-ancestors 'none'`, `permissions-policy: camera=(), geolocation=(), microphone=(self), usb=()`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, and `cache-control: public, max-age=31536000, immutable` on a hashed asset (`/assets/index-*.js`). The page CSP that limits scripts and connections is the meta tag in `index.html`; the header carries `frame-ancestors` only, because that directive is ignored in a meta tag. Docs host: `docsite/public/_headers` sets the same set (HSTS, nosniff, `strict-origin-when-cross-origin`, permissions policy, `X-Frame-Options`) plus a CSP with `frame-ancestors 'none'` that allows the inline scripts of the Next static export; the `docsite` workflow checks that `_headers` reaches the export and the screenshots job runs every page under that CSP and fails on a violation. The deploy to the custom domain is done by the operator, so the live docs host shows the headers only after that redeploy. Not checked: a browser run of `network.spec.ts` against the live host, and the custom domains. A curl read of the three custom domains on 2026-11-09 is recorded in `docs/evidence/security/live-checks-20261109.md` (headers only, no browser). The evidence above is for the workers.dev host and the API host; a custom domain served through Cloudflare can add its own injected scripts and its own headers, which this review did not inspect (see SEC-24).
- **SEC-11** ACCEPTED. `docs/PRIVACY.md`: audio is streamed to the speech vendor and not stored here, names are stored with the auction, chatter transcripts are redacted. Accepted risk: vendor retention terms are unverified. Compensating control: sandbox-only notice in the voice README and the privacy page.
- **SEC-12** PASS. `audit.yml` green on main; every waiver in `audit-waivers.json` has a reason and expires 2027-02-01; the waived advisories are dev and test tooling that the esbuild bundle of the API does not ship. The one runtime waiver is zod (GHSA-mrhx-c7xc-m3w5, no 3.x fix): HTTP bodies are capped at 64 KiB, WebSocket frames at 16 KiB (`host/node-ws.ts`) and audio frames at 8 KiB (`host/audio-ws.ts`), each cap applied before parsing. `npm audit` still lists advisories (dev tooling and the waived set); read `audit.yml` for the current result.
- **SEC-13** PASS. `payments/src/webhooks/verify.ts` trusts only an https certificate URL on `paypal.com` or a subdomain, without userinfo (`webhook.test.ts`). The server never fetches a client-supplied URL.
- **SEC-14** PARTIAL. T-QA-078 `dos.test.ts` (hanging model gives way to rules, the 61st call per minute is limited), 8 KiB audio frames, body limits in `http/app.ts`. Proxy hops: `TRUSTED_PROXY_HOPS` was 1 in `render.yaml`; the `sec14-source-probe` run 42564773281 (old, hops=1) logged `src` values that matched neither probe runner, and run 42578306983 (https://github.com/harshbhx/gavel-auction/actions/runs/42578306983, new, hops=2) logged `src=8692d2ad411a` and `src=8a4d2cf432c0`, exactly the tags of its two runners (`docs/evidence/security/SEC-14/`, log lines quoted; the Render logs are not in the repository). `render.yaml` now sets 2. Verified once on the Render API on 9 Nov 2026 with two probe rooms behind the custom domain. Residual: other paths were not probed (a direct call to the `onrender.com` address, other clients and data centres), and the row stays PARTIAL.
- **SEC-15** PARTIAL (agent-run scan, not reviewed by someone other than its author). Redaction is unit tested (`logger.test.ts`). Run 42566851766 (https://github.com/harshbhx/gavel-auction/actions/runs/42566851766, workflow `evidence-log-scan` on `main`, 9 Nov 2026) ran scenario S01 on the real server in stack mode with fake payments on a CI runner, sent six probe requests, then scanned the server log (43 lines) and the data folder (lock file, ledger, payment audit, holds, journals, rooms) for nine canary values (admin key, token secret, judge key, PayPal client secret, client id and webhook id, a buyer email, a card number, a bearer token) and for patterns. Verdict PASS: 0 findings. The probes were a health check (200); a canary query string and a bad bearer on a lookup (404); a bad invite carrying a canary email and card in the body (404); a judge room create with the judge key header (201); an admin export with the admin key header (404); and an admin route with a wrong key (401). A negative control, the same scanner on a log with one canary added (44 lines), failed with 1 finding, as required, so the scan can fail. Evidence: `docs/evidence/security/SEC-15/` (README with sha256 per file; the scanned `server.log` has sha256 96f3c9a16d021877f97b00330fbfc857c768fac91d80d2c620e199e9769402e7, and `log-scan.json` 6c3cb943e209e6956b232ccfabfbab164111c4b39d1dff2bbb7a6d8961627127). Not covered: the Render service logs, raw audio transcripts (S01 sends no audio), routes and error paths the run does not call (the probes that answered 404 may not have reached a handler's success path), the real PayPal sandbox payments mode, and other scenarios. No reviewer other than the author has looked at it, so the row is PARTIAL, not PASS. An earlier partial scan of Actions job logs (2026-11-09, `docs/evidence/security/SEC-15-log-scan-20261109.md`) found no secret shapes in the nightly sandbox job log or six browser-spec job logs; those logs hold no server stdout.
- **SEC-16** PASS. `/ops/*`, `/metrics` and `/admin/*` need `x-admin-key` (constant-time compare, 24 character minimum, must differ from the token secret). Live GETs answer 401. No HTML admin page is served.
- **SEC-17** PASS. API sends `frame-ancestors 'none'`; no server redirect takes a client URL (return URLs are fixed in the PayPal SDK flow). The web host answers with `content-security-policy: frame-ancestors 'none'` and `x-frame-options: DENY` (live `curl -sI https://gavel-web.creharsh.workers.dev/` on 2026-11-07).
- **SEC-18** PASS. T-QA-079 `access.test.ts` (events carry the server clock whatever `clientTs` says). [ci run](https://github.com/harshbhx/gavel-auction/actions/runs/42363011490).
- **SEC-19** OPEN (new; agent code review 2026-11-09, no human review yet). Threat: a create route that needs no operator key (`POST /api/judge/rooms`) lets anyone on the internet open real sandbox rooms, so it could be used to exhaust the host, to mint a token that reaches operator routes, to leave rooms running, or to point real PayPal at an unattended endpoint. Mitigations: the route answers 404 unless `JUDGE_ROOMS=true`; boot validation refuses the flag with a non-sandbox `PAYPAL_ENV` or `PAYPAL_BASE_URL` and, on a production-like host, without `PAYMENTS=sandbox`; `DEMO_MODE` stays refused in production; per-address and host-wide hourly create limits (the address is stored only as a short hash); a cap on live rooms counted before the first await so a burst cannot overshoot it; a fixed safe lot (small reserve, short window, ceilings under the payments cap); the response carries room-scoped auctioneer, screen and read-only reviewer tokens only, which every admin route rejects (they need `x-admin-key`); a sweeper ends each room at its lifetime, voids unsettled holds through the normal abort path and revokes the creator token; every audit line carries `judgeRoom: true`; the operator can switch creation off at runtime with `POST /api/judge/pause` (admin key) or boot paused with `JUDGE_ROOMS_PAUSED=true`. Residual: judges behind one shared address share the per-address limit (`JUDGE_ROOMS_PER_IP_HOUR`); an attacker with many addresses can fill the room cap and block judges until rooms expire; the real sandbox path (hold, hammer, void) is covered by the fake PayPal in CI and by a sandbox spec that is skipped without secrets.
- **SEC-20** OPEN (new; agent code review 2026-11-09, no human review yet). Threat: a receipt link is passed around, so whatever its token opens is opened for whoever holds it. Mitigations: the token is its own kind (`receipt`) with a four hour lifetime equal to the bidder session; it names one bidder in `sub` and carries no `bidderId`, so every route that wants a session, screen or auctioneer token refuses it and the socket join refuses it; it opens exactly one read-only route, `GET /api/auctions/:id/receipt`, which refuses every other kind; it is minted only by `POST /api/auctions/:id/receipt-link` from that bidder's own session token; the response is the bidder snapshot cut down to the lot title, the hammer outcome, the holder's own roster row (display name and paddle), the winner's paddle without a name and the holder's own hold (no other bidder, no audit rows, no join code, no ceiling object); the token rides in the URL fragment, which the browser never sends to a server or a log and the app removes from the address bar after reading it. Tests: `http-receipt.test.ts` (scoping, expiry, tampering, wrong audience, wrong kind, redaction), `token.test.ts`. Residual: a copied link works until it expires and cannot be revoked one by one (the same as a session token); the QR code and the printed page carry the link.

- **SEC-21** PARTIAL (new, tested; agent code review 2026-11-09, no human review yet). Threat: a second key that skips the public room limits could be guessed, leaked or turned into operator access. Mitigations: `JUDGE_KEY` is a different secret from `ADMIN_KEY` (boot refuses them equal) and opens only keyed judge rooms, never an admin route; the header is compared in constant time; a wrong key answers 401 and counts as a strike on the same lockout as a wrong room code (five strikes, 15 minutes), and a locked-out address is refused even with the right key; keyed rooms have their own cap (`JUDGE_KEY_ROOMS_MAX`, 3 by default) and 20 creates per hour; every keyed action is audited with the source as a short hash and never the key; the web app keeps the key in `sessionStorage` for the tab and never in a URL. Tests: `http-judge-key.test.ts`, `config-judge-key.test.ts`, `boot-judge-key.test.ts`, `client-key-parity.test.ts`. FEAT-60 adds per-judge keys (`JUDGE_KEYS`, only the sha256 of each secret configured, per-key room and hourly caps, expiry, runtime revoke by the operator key, `http-judge-api-keys.test.ts`); a key never reaches `requireAdmin`, is never logged (only its id), and rooms opened with a key refuse voice. Residual: a leaked key lets its holder open up to the keyed cap until the key is rotated on Render; the lockout is per address hash, so many addresses can still guess slowly; one live check with a wrong key is recorded: `POST /api/judge/rooms` with a wrong `x-judge-key` answered 401 `judge_key_invalid` on 2026-11-09 03:19 UTC (`docs/evidence/security/live-checks-20261109.md`). The five-strike lockout and the right-key-while-locked-out refusal were not exercised on the live host.
- **SEC-22** PARTIAL (new, tested; agent code review 2026-11-09, no human review yet). Threat: a link meant for reading is used to act. Mitigations: the `reviewer` token is its own kind (12 hours, `auth/token.ts`), has a screen's read view, and is refused by every bid, control, join and mint route; `GET /api/judge/rooms/:id/ledger` accepts only a `reviewer` or `auctioneer` token for that room, exists only for judge rooms, and checks the hash chain before it answers (a broken chain answers 409, not a bundle that looks fine); the response is `no-store`. By design, a reviewer link keeps reading the ledger for its whole 12 hour life, also after the room ends, so a judge can verify the audit trail later; it is read only and the bundle is only the public chain export. Tests: `http-judge-rooms.test.ts`, `token.test.ts`, `http-judge-key.test.ts` (bidder session and screen tokens refused, reviewer allowed), `http-receipt.test.ts` (no ceiling key in a receipt). Residual: a copied reviewer link works for its 12 hours, after the room ends too, and cannot be revoked one by one; the bundle contains the room's public audit trail, which is read-only but not secret.
- **SEC-23** PARTIAL (new, tested; agent code review 2026-11-09, no human review yet). Threat: a hold that skips PayPal could be used outside a judge room or be mistaken for a real one. Mitigations: simulated holds exist only in judge rooms and only while `JUDGE_SIM_HOLDS` is not `false`; the authorization id carries the `sim-auth-` prefix and `withSimulatedHolds` answers only those ids, so a normal hold never reaches that code and a simulated id never reaches PayPal; boot refuses judge rooms on a non-sandbox PayPal setting; no money is held or moved, and the join screen offers the simulated hold beside the PayPal sandbox option. Tests: `http-judge-sim-hold.test.ts`, `sim-holds.test.ts`, `boot-judge-sim-hammer.test.ts`. Live: `GET /api/judge/capabilities` reports `simHolds: true` (2026-11-09). Residual: a simulated settlement is remembered only by the running process (a restart reads the hold as still held and the settlement retries); no live simulated bid was placed for this review.
- **SEC-24** PARTIAL. The docs site sets its headers through `docsite/public/_headers` and the `docsite` workflow checks that the file reaches the export. Recorded on 2026-11-09 (`docs/evidence/security/live-checks-20261109.md`, raw output with timestamps in `live-headers-20261109.txt`): `gavel.dualmindlab.tech` and `docs.gavel.dualmindlab.tech` send the headers of their `_headers` files, and `api.gavel.dualmindlab.tech` sends its CSP, HSTS, nosniff, referrer and permissions headers. Cloudflare adds one same-origin script, `/cdn-cgi/challenge-platform/scripts/precursor/main.js`, to the HTML of both custom domains. Not verified: that a browser runs it without a CSP violation, the workers.dev docs host, and a repeat of the check over time (it was taken once, by hand, not by a workflow).

## Agent code review of SEC-19 to SEC-24 (2026-11-09)

**This is an agent code review (not a human independent review).** The rows above ask for a second
reviewer who did not write the code. A review agent read the code and the tests named below from a
fresh clone at commit `710163d`, and made read-only requests to the live hosts. It did not write
the code under review, but it is not a person and it does not replace one. For that reason the
Reviewer column says `agent-only`, the Status column is unchanged, and issues #2190, #2195 and
#2194 stay open until a human reviewer signs. The verdicts below are the agent's, and a human
reviewer is free to disagree.

Paths are under `packages/server/` (code in `src/http/`, tests in `test/`).

### SEC-19 Key-less judge rooms: agent verdict PARTIAL

- What the code does: `create` answers 404 unless `JUDGE_ROOMS` is on (`judge-rooms.ts:425`),
  checks the pause flag (`:438`), then applies the per-address, host-wide and live-room limits and
  records the attempt before any await (`:452-469`), so a burst cannot overshoot them. The lot
  is fixed (`judgeRoomConfig`, `:187-204`: reserve 1000 cents, ceilings of 2000 and 5000 capped by
  the payments cap). Boot refuses the flag without sandbox PayPal (`config.ts:190-203`). The sweeper
  aborts the room, raises the auctioneer floor and drops tokens at expiry (`:360-388`).
- Test evidence: flag off gives 404 (`http-judge-rooms.test.ts:124`), safe defaults and no admin key
  (`:141`), per-address, host-wide and burst limits (`:224-248`), kill switch (`:262-274`), expiry
  and cleanup (`:281`), token scoping (`:312`), audit without the raw address (`:213`); boot refusals
  in `config-judge-rooms.test.ts:40-64` and `boot-judge-rooms.test.ts:55-65`; an end-to-end run in
  `boot-judge-rooms.test.ts:78`. The nightly `judge-smoke` workflow walks the live journey.
- Gaps: the row text says the response carries "auctioneer and screen tokens only", but the response
  also carries a read-only `reviewerToken` and `reviewerLink` (`:511-512`); the row is corrected by
  this PR. The per-address map is never pruned (`perIp`, one small entry per address that created a
  room, so growth is bounded by the host-wide hourly limit). Per-address limits depend on the client
  address being right behind the proxy (issues #2067 and #2069, unconfirmed). No live create was made
  for this review.
- Why PARTIAL and not PASS: no human review, and the proxy question above is open.

### SEC-20 Shareable receipt link: agent verdict PARTIAL

- What the code does: `receipt-link` mints a `receipt` token only from a `session` token for the same
  room and bidder (`receipt.ts:33-43`); `GET .../receipt` accepts only that kind (`:48`) and returns
  the snapshot cut down by `receiptSnapshot` (`:11-22`): own roster row with the name, the winner's
  paddle without a name, no other bidder, no `you`, no join code, no audit rows, `leaderId` null.
  Token validation refuses a receipt token that carries a `bidderId` (`auth/token.ts:198-201`).
- Test evidence: `http-receipt.test.ts:133` (lifetime), `:142` (holder only), `:157` (mint rules),
  `:168` (no other route), `:183` (expiry), `:191` (tampering, other kind, other auction), `:209-244`
  (payload shape).
- Gaps: the snapshot keeps the room `config` (reserve, increments, end time) and, in `settlement`, the
  holder's own hold with their own ceiling; both are the holder's own or public data, but the test
  pattern `"ceiling"` does not match the key `ceilingCents`, so own-ceiling presence is not asserted
  either way. A copied link works until it expires and cannot be revoked one by one.
- Why PARTIAL: no human review and the residual stands.

### SEC-21 Judge key and lockout: agent verdict PARTIAL

- What the code does: `checkKey` (`judge-rooms.ts:534-550`) checks the lockout before the key, so a locked-out
  address is refused even with the right key; it always runs the comparison, hashing both sides
  before `timingSafeEqual` (`:207-211`), so an unset key costs the same time as a wrong one; a wrong
  or empty key is a strike on the shared guard (`code-guard.ts:238-271`, five strikes, 15 minutes) and
  never falls back to the public path (`:433-437`). Boot refuses a key equal to `ADMIN_KEY` or
  `TOKEN_SECRET`, shorter than 32 characters, or without judge rooms (`config.ts:182-189`). Keyed
  rooms count against their own cap and 20 creates per hour (`:442-450`). The audit lines hold a
  short address hash and `via`, never the key (`:493-502`).
- Test evidence: `http-judge-key.test.ts:221-273` (401, no room, no fallback, empty key, lockout
  including the right key, shared strikes with wrong room codes, recovery after the window),
  `:158-213` (bounds and burst), `:290` (audit holds no key or address), `:365` (the judge key is not
  an operator key); `config-judge-key.test.ts:29`; `boot-judge-key.test.ts:36,84`.
- Gaps: the lockout is keyed by a hash of the resolved client address. If the host sees the Cloudflare
  edge address instead of the client (issues #2067 and #2069, unconfirmed), five wrong keys from one
  edge could lock the right key out for others on that edge, and the per-address limits would act per
  edge. The request body is parsed before the key is checked (`:428` before `:434`), which costs a
  little work for an unauthenticated caller; the body limits apply. No live wrong-key request was made,
  to avoid taking a strike on the live lockout.
- Why PARTIAL: no human review, and the proxy question is open.

### SEC-22 Reviewer token and ledger route: agent verdict PARTIAL

- What the code does: `ledgerBundle` answers 404 unless judge rooms and a ledger are present
  (`:576`), verifies a `reviewer` or `auctioneer` token for that room (`:580`, kinds and audience
  checked by `verifyFor`, `app.ts:345-362`), requires the judge-room marker (`:582`), checks the hash
  chain before answering and answers 409 for a broken chain (`:586-601`), and sets `no-store`. The
  bundle is the redacted public export (`admin/replay-bundle.ts`). The reviewer kind is read-only in
  `read.ts:32,48` and absent from every bid and control route's kind list.
- Test evidence: reviewer reads snapshot and events, cannot control, cannot read another room, and the
  ledger route works for a judge room only (`http-judge-key.test.ts:312-363`); `token.test.ts` covers
  the 12 hour lifetime. The evidence column of the table named `http-judge-rooms.test.ts`, but the
  reviewer tests are in `http-judge-key.test.ts`; the table is corrected by this PR.
- Gaps: only `control` is tried with a reviewer token; bid, join and mint routes are covered by the
  kind lists in code, not by a test. Nothing asserts that a `session` or `screen` token is refused by
  the ledger route. The non-judge-room case accepts 401 or 404 (`:354`). The route checks the marker
  but not its expiry, so a reviewer link keeps reading the public export for its 12 hours after the
  room ends (read-only, public data, but longer than the room).
- Why PARTIAL: no human review, and the test gaps above.

### SEC-23 Simulated holds in judge rooms: agent verdict PASS (code level, agent only)

- What the code does: the route needs `JUDGE_ROOMS` and the simulated-hold option (`:699`), a `session`
  token for the room (`:701`), the judge-room marker and its expiry (`:705-709`), a ceiling from the
  room's offered presets (`:712`) and an auction that still takes holds (`:715`). The hold id is
  `sim-hold-<bidderId>`, written once under the per-hold queue; a second ceiling is a `conflict`
  (`sim-holds.ts:36-67`). `withSimulatedHolds` answers only `sim-auth-` ids and passes every other id
  to the real gateway (`:74-124`), and only the sim-hold route writes such an id. Boot wraps the
  gateway only when judge rooms are on, and judge rooms need sandbox PayPal.
- Test evidence: `http-judge-sim-hold.test.ts:163` (place), `:183` (repeat gives 409), `:207`
  (ceiling, name, extra fields), `:220` (session of the same room), `:234` (never a normal auction),
  `:253` (off gives 404), `:264` (closed and expired), `:281` (probe); `sim-holds.test.ts:20-105`
  (write once, race, settle without the real gateway, real ids pass through);
  `boot-judge-sim-hammer.test.ts:77-286` (hammer, unsold, restart).
- Gaps: the real-gateway separation rests on the `sim-auth-` prefix, and a real PayPal authorization
  id never has it; no test feeds a real-looking id that starts with the prefix. The restart caveat in
  the row stands (functional, no money moves). No live simulated bid was placed for this review; the
  nightly `judge-smoke` walk covers the journey.
- Why PASS: every path that could write or settle a simulated hold is gated to judge rooms, and no
  path from a client reaches the real gateway with a simulated id. A human reviewer can still
  disagree.

### SEC-24 Docs host and custom-domain headers: agent verdict PARTIAL

- What was checked: `curl -sI` on 2026-11-09 against `https://docs.gavel.dualmindlab.tech/` (and
  `/docs/start/guided-tour`, and a 404 path) shows HSTS, the CSP from `docsite/public/_headers`,
  `nosniff`, `strict-origin-when-cross-origin`, the permissions policy and `X-Frame-Options: DENY` on
  all three. `https://gavel.dualmindlab.tech/` sends the web app's set (HSTS, `frame-ancestors 'none'`,
  `nosniff`, `no-referrer`, permissions policy with the microphone allowed for itself, `DENY`).
- Cloudflare scripts: both custom domains serve `/cdn-cgi/challenge-platform/scripts/precursor/main.js`
  from the same origin, which `script-src 'self'` allows. No third-party Cloudflare beacon was found.
- Not checked: the `pages.dev` host of the docs project, and whether a browser blocks anything on a
  real page load (a CSP console check needs a browser run, which belongs in Actions).
- Why PARTIAL: headers are present, but the pages.dev host and a browser check are missing.

### Sign-off wording

None of the verdicts above is a human sign-off. When a person reviews a row they replace `agent-only`
with their name, set the status, and record any difference from the agent's verdict.

## Sign-off

Submission is allowed when no P0 item is FAIL or OPEN. All eight P0 items (SEC-01 to SEC-07 and
SEC-18) are PASS as of 2026-11-07. PARTIAL and OPEN rows at P1 and P2 are residual risks listed above, not sign-offs.
