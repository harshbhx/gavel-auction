# Security review (R-QA-036)

Checklist SEC-01 to SEC-18 from `docs/specs/quality/SPEC-quality.md` section on security. Each item
is PASS, FAIL (with an issue link) or N/A (with a reason). A P0 FAIL blocks submission. The reviewer
of an item is never its author. Status OPEN means nobody has signed the item off yet; the automated
check listed under Evidence is what the reviewer re-runs.

| ID     | Pri | Area                                        | Status | Evidence (automated check)                            | Reviewer | Date |
| ------ | --- | ------------------------------------------- | ------ | ----------------------------------------------------- | -------- | ---- |
| SEC-01 | P0  | Access control on auctioneer actions        | OPEN   | T-QA-070, `packages/e2e/test/security/access.test.ts` |          |      |
| SEC-02 | P0  | Bidder identity and token binding           | OPEN   | T-QA-071, `access.test.ts`                            |          |      |
| SEC-03 | P0  | Webhook authenticity                        | OPEN   | T-QA-072, `webhook.test.ts`                           |          |      |
| SEC-04 | P0  | Secrets in repo, logs and bundle            | OPEN   | T-QA-073, gitleaks workflow, bundle scan              |          |      |
| SEC-05 | P0  | Sandbox-only guard and boot validation      | OPEN   | `sandbox.test.ts`                                     |          |      |
| SEC-06 | P0  | Money integrity (integer cents, ledger)     | OPEN   | engine and payments tests                             |          |      |
| SEC-07 | P0  | Injection and rendering of untrusted text   | OPEN   | T-QA-074, `fuzz.test.ts`                              |          |      |
| SEC-08 | P1  | Abusive input caps                          | OPEN   | `abuse.test.ts`                                       |          |      |
| SEC-09 | P1  | CORS and origin allowlist                   | OPEN   | T-QA-075                                              |          |      |
| SEC-10 | P1  | Transport and security headers, CSP         | OPEN   | T-QA-076, `headers.test.ts`, web `network.spec.ts`    |          |      |
| SEC-11 | P1  | Audio and personal data                     | OPEN   | manual review                                         |          |      |
| SEC-12 | P1  | Dependency risk                             | OPEN   | T-QA-077, `audit.yml`, `audit-waivers.json`           |          |      |
| SEC-13 | P1  | SSRF                                        | OPEN   | `webhook.test.ts` (cert URL host allowlist)           |          |      |
| SEC-14 | P1  | Denial of service on the parse path         | OPEN   | T-QA-078, `dos.test.ts`                               |          |      |
| SEC-15 | P2  | Logging hygiene                             | OPEN   | log scan after S01                                    |          |      |
| SEC-16 | P2  | Admin and ops pages                         | OPEN   | manual review                                         |          |      |
| SEC-17 | P2  | Clickjacking and PayPal return URL redirect | OPEN   | manual review                                         |          |      |
| SEC-18 | P0  | Server time is authoritative                | OPEN   | T-QA-079                                              |          |      |

## How to record a result

1. Re-run the listed check in CI or review the code named in Evidence.
2. Replace OPEN with PASS, FAIL or N/A. A FAIL needs an issue link in a Notes line below; an N/A
   needs a reason.
3. Fill in the reviewer and date. The reviewer is not the author of the code under review.

## Notes

No FAIL is recorded yet.

## Sign-off

Submission is allowed when no P0 item is FAIL or OPEN.
