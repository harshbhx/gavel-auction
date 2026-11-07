# Live screen tour

The same idea as `../screens`, run against the deployed site instead of a dev server with mocks.
Run it from the `ui-screens-live` workflow (manual dispatch with the inputs `web_url` and
`api_url`); it uploads the artifact `ui-screens-live` with every PNG plus `index.html`,
`INDEX.md` and `manifest.json` (30 days). Download it with
`gh run download <run-id> -n ui-screens-live`.

Locally, with browsers installed: set `GAVEL_LIVE_WEB`, `GAVEL_LIVE_API` and optionally
`GAVEL_LIVE_ADMIN_KEY`, then `npm run test:screens:live -w @gavel/web`.

## What is taken

- No room needed: landing (default, code typed, code not found), demo launcher, join with an
  unknown room, operator key form and wrong key, replay of a missing recording, not-found.
- With the staging operator key (secret `GAVEL_STAGING_ADMIN_KEY`): two throwaway rooms are made
  through the public routes, one left open and one hammered with no bids. On them: landing by a real
  code, join (open, ended), register (name step), bid (open, ended, no session), console (open,
  ended, no token), big screen (open, ended), audit trail (open, ended) and the receipt of an ended
  lot.

File names and the four projects (phone, desktop, dark, projector) are the same as the offline
tour, so `../screens/build-index.mjs` builds the index.

## What is not taken

- Anything that needs a bid or a payment: live bidding, outbid, winning, sold and settled states,
  the PayPal approval step, hold errors. They need real bidders with a sandbox hold, so the offline
  tour keeps covering them with scripted frames.
- The console and the big screen mid-auction with bids.

## Safety

Traces and videos are off, the operator key is read from the environment only and is never typed
into a page, and room tokens travel in the URL fragment. The key is a secret, so the workflow log
masks it. A throwaway room stays on the host until it is cleaned up there.
