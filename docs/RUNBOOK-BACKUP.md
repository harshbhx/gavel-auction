# Ledger backup runbook

The `backup` workflow (R-QA-046) takes a daily snapshot of every auction ledger. The ledger is
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
- Uploads only `ledger-snapshot.tgz.gpg` (30 days).

## Restore or audit

Download the artifact, then `gpg --decrypt ledger-snapshot.tgz.gpg | tar -xz`. Each
`<auctionId>.ndjson` verifies with the chain check; the last line is the head.
