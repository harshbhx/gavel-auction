# Judge walkthrough

A short path through the repository for judges. Everything is PayPal sandbox only: no live PayPal call is made and no real money moves. A bid is a hold (an authorization); nothing is charged before capture at the hammer.

## Status, stated plainly

- The web UI is owned by a contributor and may still be in progress. See `README.md` for the current run instructions instead of relying on any step written here.
- The hosted demo is not published yet. `docs/DEMO.md` lists what is available and what is not.
- Real versus recorded: the fake PayPal demo and the replay are recorded or simulated, not live PayPal. Gates G0, G1, G2 and G4 have run against the real sandbox; G3 (a real probe in progress since 7 Nov 2026 03:06 UTC, final about 12 Nov 06:17 UTC, no result recorded) and G5 (synthetic noise-free speech only, no real-room or noisy-room test) have not produced a real-world result. Committed run logs exist for G1, G2 and G4 only; G0 is an Actions run log. See `docs/GATES.md` for each gate and its result. Settlement of a whole auction and crash recovery have been exercised against the fake PayPal only.

## Five minute path

The table below is TARGET behaviour: steps 1 and 2 need a deployed staging URL (the `JUDGE_URL` repository variable), and until that is configured the nightly smoke fails red (it never reports a skipped pass).

This path cannot be followed today: no hosted demo URL is published (see `docs/DEMO.md`). `packages/e2e/specs/judge-walkthrough.spec.ts` covers steps 1 and 2 on the fake stack only. The nightly `.github/workflows/judge-smoke.yml` runs that spec against the hosted site and fails when the repository variable `JUDGE_URL` is unset, so a night that tested nothing cannot look like a pass. Steps 3 to 5 have no automated check.

| Step | Persona    | What to do                                          | Expected outcome                                                                                         |
| ---- | ---------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | Judge      | Open the hosted web URL.                            | The landing page shows a heading and the "Start a demo auction" button.                                  |
| 2    | Judge      | Press "Start a demo auction".                       | A demo auction opens with a link for each role: big screen, auctioneer console, bidders and audit trail. |
| 3    | Auctioneer | Open the auctioneer console link.                   | The console shows the lot and its controls.                                                              |
| 4    | Bidder     | Open a bidder link in a second tab and place a bid. | The bid shows on the big screen. A bid is a hold; nothing is charged.                                    |
| 5    | Auditor    | Open the audit trail link.                          | The ledger entries show, chained by hash.                                                                |

Where to look afterwards:

- Quality report: `/quality` on the hosted site (built by `.github/workflows/report.yml`); it names the commit it was built from.
- Version: `GET /version` on the API host returns the deployed commit; it should match the report.
- Audit export: the audit trail link in step 5, and the verification steps below.

Steps 3 and 4 depend on the web UI and are not covered by any automated check; the spec covers steps 1 and 2 only.

## Run the fake-PayPal demo

1. Follow the "Run it" section of `README.md` (Node 22 and npm; `npm ci` first).
2. Start the server with `PAYMENTS=fake`. The built-in fake PayPal answers every call, so no network access and no PayPal account are needed. Production mode refuses fake payments.
3. For the web part, see `README.md` and `docs/DEMO.md` for the current instructions.

The fake PayPal is a test double. Behaviour seen there says nothing about the real PayPal sandbox; the gate evidence below does.

## Read the evidence

- `docs/GATES.md`: the gates, what each proves, and its result (PASS, FAIL or NOT RUN).
- `docs/evidence/<gate>/`: raw sandbox run logs as JSON lines. Tokens, buyer emails and payer IDs are replaced by `[REDACTED]`.
- `docs/PUBLIC-REPO-CHECKLIST.md`: what was checked before the repository was made public, and the known limits.

## Verify the replay bundle

A replay bundle (`packages/shared/src/replay-bundle.ts`, `REPLAY_BUNDLE_VERSION` 1) carries a public export of the auction ledger. The public export is a redacted hash chain; `verifyPublicExport` in `@gavel/engine` (`packages/engine/src/ledger/public-export.ts`) checks its version, sequence numbers, links and hashes and returns `{ ok: true }` or the first bad index and the reason (`bad_hash`, `bad_prev`, `bad_seq`, `bad_version` or `truncated`).

1. Take the public export entries from the bundle.
2. Call `verifyPublicExport(entries)`. Pass `expectedHead` (`{ seq, hash }`) to also detect a truncated chain.
3. Any edit to an entry makes the result `ok: false` at the edited index.

`packages/engine/test/public-export.test.ts` shows working calls, including tampered and truncated chains.

## Clean clone check

The `clean-clone` workflow (`.github/workflows/clean-clone.yml`) checks a fresh checkout each week: install, typecheck, shared and engine unit tests, the scenario tests, and `scripts/clean-clone-check.mjs` (license, run instructions, no tracked env or key files, required docs).
