# Screen tour

Browser specs that open every screen of the web app in every state they can reach and save one PNG
per state. They only look: no spec asserts pixels, and no file under `src` is touched. Dhairya's
visual regression and accessibility specs (`test/visual`, `playwright.config.ts`) are separate and
unaffected.

## Run

CI does the work: the `ui-screens` workflow (manual dispatch, or a pull request that touches these
files) runs the specs and uploads the artifact `ui-screens`, which holds every PNG plus
`index.html` (contact sheet), `INDEX.md` and `manifest.json`. Download it with
`gh run download <run-id> -n ui-screens`.

Locally, with browsers installed: `npm run test:screens -w @gavel/web`, then
`npm run screens:index -w @gavel/web`. Output goes to `packages/web/ui-screens-out`.

## Naming

`<view>--<state>--<project>.png`, with the project one of:

| Project           | Viewport      | Theme     |
| ----------------- | ------------- | --------- |
| desktop-light     | 1440x900      | light     |
| phone-light       | 390x844 at 2x | light     |
| desktop-dark      | 1440x900      | dark      |
| desktop-projector | 1440x900      | projector |

## How states are reached

No real PayPal, server or network is used.

- Room routes (bid, console, screen, audit, receipt): the socket is answered by Playwright from
  scenario frames (`src/testing/scenarios` and `support/frames.ts`). Each state delivers the frames
  up to a chosen scenario time, with the page clock fixed to that moment.
- Join, register, demo and operator pages: the HTTP API origin is answered by `mockApi`.
- Approval: the fake adapter (`VITE_PAYMENTS=fake`). The return route from PayPal uses the PayPal
  adapter's redirect step against the mocked API, which is how every hold error is shown.
- Replay: the recording bundle is served from the happy scenario and a controlled clock plays it.

## Files

- `playwright.screens.config.ts`: four projects, own dev server on port 4174.
- `support/harness.ts`: fixtures, socket and API mocks, screenshot helper.
- `support/frames.ts`: extra scenarios for states the stock ones do not cover.
- `public.spec.ts`, `register.spec.ts`, `bidder.spec.ts`, `console.spec.ts`, `screen.spec.ts`,
  `replay.spec.ts`: the screens.
- `build-index.mjs`: writes the index from the file names.

## States not reachable

- Voice listening, muted and outage banners: the app has no microphone wiring on the bidder or
  console routes (`audioSink` is never passed), so only the transcript feed and confirmations show.
- Registration approval cancelled and declined: the fake adapter has no UI switch for them.
- Landing busy and server-down variants and the demo launcher's links list: the app never renders
  them through a route (the launcher navigates away at once).
- The error boundary and the boot configuration error: they need a render crash or a bad build.
