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

## States drawn on a component page

Some states are not reached by any route: the app passes no props or inputs that produce them.
They are drawn by `components.spec.ts` on `support/pages/harness.html`, a page served by the same
dev server that renders the real component with the props the routes never pass. The page lives in
`test/screens/support/pages`, is imported by nothing under `src` and is not part of any build, so
production code is unchanged (no file under `src` was edited).

| View and state                                                               | How                                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| landing `busy`, `server-down`                                                | `LandingScreen` with `status` set                                                                     |
| demo `links`                                                                 | `DemoLauncher`, start clicked, the navigation after it left out                                       |
| console `shortcut-help`                                                      | `ShortcutHelp` open                                                                                   |
| console `voice-requesting`, `voice-listening`, `voice-denied`, `voice-error` | `VoiceFeed` with each microphone state                                                                |
| register `approve-cancelled`, `approve-declined`                             | the real `FakeApprovalAdapter` in `cancel` and `decline` mode, through `useApproval` and `Approve`    |
| error `boundary`                                                             | `ErrorBoundary` around a component that throws                                                        |
| boot `config-error`                                                          | a second dev server (port 4175) started without `VITE_SANDBOX`, so `src/main.tsx` shows its own error |

These are component renders, not whole routes: the page around them is the sandbox banner only.

## States not reachable

- Muted and outage banners (bidder and console): the app has no such banner. There is no copy,
  component or state for them in `src`, and the console voice feed shows microphone states only
  (covered above as `voice-denied` and `voice-error`). Drawing them would need a new UI.
- The console and bidder routes still never mount the microphone (`audioSink` is not passed) and
  never mount `ShortcutHelp`; the component page shows those components, not the routes.
