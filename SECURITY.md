# Security Policy

## Scope

GAVEL is a hackathon project that runs against the PayPal sandbox only. It handles no real payment instruments. Reports about the following are in scope: access control on auctioneer and bidder actions, token handling, webhook verification, input validation on HTTP and WebSocket endpoints, response headers, and leaked secrets in the repository or the web bundle.

## Reporting a vulnerability

Please report privately. Do not open a public issue or pull request that describes the problem.

- Use the "Report a vulnerability" button on the Security tab of the repository (private advisory), or
- Email dhairyapatel0246@gmail.com with the subject line "GAVEL security".

Include what you found, the steps to reproduce it, the affected commit or URL, and the impact you expect. Do not include real credentials. If you found a secret, say where it is and do not copy it elsewhere.

## What to expect

- Acknowledgement within 3 days.
- A first assessment within 7 days.
- A fix or a documented decision, and credit if you want it, once the issue is resolved.

## Handling

Findings are tracked against the security review checklist in `docs/specs/quality/SPEC-quality.md`. Any leaked credential is revoked first and removed from history second.

## Supported versions

Only the current `main` branch is supported.
