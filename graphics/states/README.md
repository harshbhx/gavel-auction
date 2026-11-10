# States gallery

Reproducible capture of the UI states library in `brand/screens/` (GFX-13). Nothing runs on a laptop or the VM.

## Run

Open the Actions tab, run `states-gallery` (or push a change under `graphics/states/`, which runs it on the pull request). Then:

```
gh run download <run-id> -n states-gallery -D states-out
```

The artifact holds the named images by area, `devpost/` (3:2 crops), `contact/` (review sheets, not committed), `manifest.json` and a generated `README.md`.

## Pipeline

1. `tour` job: the screen tour specs in `packages/web/test/screens` run on a local dev server, desktop-light (1440x900) and phone-light (390x844 at 2x). Sockets are scripted frames and the API is mocked, payments use the fake adapter, so no live site and no PayPal popup are involved. Reduced motion, a frozen clock (15 Jan 2026 12:00 UTC), UTC and the bundled fonts keep pixels stable.
2. `docs` job: builds `docsite/`, serves the static export and shoots the docs pages with `docs.mjs`.
3. `build` job: `build.mjs` names each PNG `NN-<screen>-<state>-<desktop|phone>.png` using `catalog.mjs` (journey order, folder, route), drops blank and pixel-identical captures, palette-optimises with libimagequant through sharp (about 400 KB or less), cuts the Devpost crops and writes the manifest and README.

## Add or change a state

Add the state to a spec under `packages/web/test/screens` (see its README), then, if it is a new screen, add a row to `CATALOG` in `catalog.mjs`; add a note to `STATE_NOTES` when the state name is terse.

## Commit the result

Copy the downloaded folders (everything except `contact/` and `manifest.json` is committed as is; `manifest.json` goes to `brand/screens/manifest.json`) into `brand/screens/`. Anything simulated is labelled sandbox; a state that needs a real PayPal popup is never captured.
