# Ledger backup runbook

The `backup` workflow (R-QA-046) takes a daily snapshot of every auction ledger and, since HRD-79, of the payment state kept beside it on the server disk. The ledger is
private: it holds each bidder's ceiling, hold reference and spoken bid transcript. The repository
is public, so the snapshot is encrypted before it is uploaded and plaintext is never stored as a
workflow artifact.

## Setup (owner, environment `production`)

1. Create a key pair offline: `gpg --quick-generate-key backup-ledger`. Keep the private key off
   GitHub.
2. Export the public half: `gpg --armor --export backup-ledger`, and store it as the secret
   `BACKUP_GPG_PUBLIC_KEY`.
3. Set the secret `ADMIN_KEY` and the variable `PRODUCTION_URL`.

If any of the three is missing the job does nothing, uploads nothing and says so in its summary.

## What it does

- Lists every stored auction with `GET /admin/export?list=1`, finished auctions included.
- Downloads each ledger with `GET /admin/export?auction=<id>` and checks the head line.
- Fails when the number of ledgers downloaded differs from the number the store lists.
- Downloads, per auction, `GET /admin/export?kind=payments&auction=<id>` (settlement journal and hold
  records, JSON to `payments/<id>.json`) and `kind=roomlog&auction=<id>` (room event log, NDJSON with a
  last `end` line, to `roomlog/<id>.ndjson`), and once `kind=payments-global` (processed webhook
  event ids with their outcome, and the kill switch state, to `payments-global.json`).
- Any of these that cannot be downloaded is listed in `FAILED.txt`, the rest is still encrypted and
  uploaded, and the run ends red.
- The export drops webhook bodies and replaces the value of any key that looks like a secret, token
  or password. PayPal client credentials and bidder passwords are not stored in these files in the
  first place; the redaction is a second guard.
- Uploads only `ledger-snapshot.tgz.gpg` (30 days).

## Restore or audit

Download the artifact, then `gpg --decrypt ledger-snapshot.tgz.gpg | tar -xz`. Each
`<auctionId>.ndjson` verifies with the chain check; the last line is the head.

### Payment state after a disk loss

The restore procedure below is documented, not exercised: no restore has been run against a real
Render disk.

1. Decrypt and unpack the newest snapshot as above. Stop the server before writing into the data
   directory.
2. `payments/<id>.json` holds `journal` (the settlement saga state, including each hold's PayPal
   authorization id) and `holds` (the hold records). `payments-global.json` holds the processed
   webhook ids and the kill switch state. `roomlog/<id>.ndjson` is the room event log.
3. The export is a JSON view, not a byte copy of `journals.json`, `holds.json` and `webhooks.json`.
   Rebuild those files from it by hand or script before starting the server; there is no import
   route.
4. The snapshot is up to a day old. Holds created, captured or voided since then are not in it.
   After any restore, reconcile against PayPal (list authorizations in the sandbox or live
   account) and void every authorization that no restored journal or hold record accounts for.
   Keep the kill switch engaged until that is done.
5. `payment-audit.jsonl` is not part of this snapshot. Render disk snapshots remain the second
   layer and should be enabled.
