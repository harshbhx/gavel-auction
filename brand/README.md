# GAVEL brand

The logo is **The Mallet G**: a heavy circular G whose crossbar is a mallet handle ending in an orange head that stands in the counter. The wordmark is the same G at a lighter weight followed by wide monoline AVEL, like a newsprint masthead. Open [`index.html`](index.html) for the usage page.

## Colours

The logo uses the app's design tokens (`packages/web/src/design/tokens.css`), so it matches the product on paper and on ink. Also recorded in [`tokens.json`](tokens.json).

| Role          | Value                                     | App token        |
| ------------- | ----------------------------------------- | ---------------- |
| Paper         | `#efe6d3`                                 | `--color-bg`     |
| Ink           | `#1d1712`                                 | `--color-fg`     |
| Signal orange | `#ff6a1f`                                 | `--color-action` |
| One colour    | `#000` on light, `#fff` on dark or photos | none             |

Orange appears once per logo (the mallet head). Never put the colour logo on orange (use the black file) or on a busy photo (use the white file).

## Files (`svg/`)

All SVGs are outlined paths: no fonts, no text, no external references, so they render the same everywhere. Every file carries `role="img"`, a `<title>` and `aria-label` of `GAVEL`.

| Group    | Files                                                                              |
| -------- | ---------------------------------------------------------------------------------- |
| Mark     | `mark-{color,black,white,reversed,plate}.svg`                                      |
| Wordmark | `wordmark-{color,black,white,reversed,plate}.svg`                                  |
| Lockups  | `lockup-h-*.svg` (horizontal), `lockup-v-*.svg` (stacked), same five variants      |
| Product  | `favicon.svg`, `app-icon.svg`, `app-icon-maskable.svg`, `og.svg`, `og-twitter.svg` |
| Motion   | `sting.svg` (paper background), `sting-transparent.svg`                            |

Variants: `color` is ink plus orange on transparent, for paper and light surfaces. `reversed` is paper plus orange on transparent, for ink and dark surfaces. `black` and `white` are one colour. `plate` is the reversed logo on its own ink background with padding, safe on any surface.

## Clear space and minimum size

- Clear space: 0.25 x the mark height on every side (25 units on the 100 unit mark grid). Keep text and edges out of it.
- Minimum width: mark 16 px, wordmark and horizontal lockup 80 px, stacked lockup 96 px. Below 24 px use `favicon.svg` (ink tile) instead of the bare mark.
- Do not recolour, outline, rotate, stretch, add shadows, or swap the orange head for another colour.

## Construction

Mark grid 100 x 100. Ring centre (50, 50), centreline radius 39, stroke 22, from -42 degrees round the bottom to 0 degrees. Handle 13 high from x 40 to x 100. Head 16 x 34 at x 32, corner radius 3. The wordmark is cap height 100 units with hand-built polygon letters (stems 19, arms 16, tracking 12 to 14) and the G at stroke 19. The lockup scales the wordmark by 0.62 with a 26 unit gap.

## Raster set and video

Rasters and the video are rendered in CI by [`brand-assets.yml`](../.github/workflows/brand-assets.yml) (run it from the Actions tab, or open a PR that touches `brand/`), never committed:

- artifact `brand-raster`: `favicon.ico` (16, 32, 48), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180), `android-chrome-192x192.png`, `android-chrome-512x512.png`, `maskable-512x512.png`, `og.png` (1200x630), `twitter.png` (1200x600) and large PNG previews.
- artifact `brand-sting`: 3 second 1080p, 30 fps `gavel-sting-1080p.mp4` and `.webm` on paper, `gavel-sting-alpha.webm` (VP9 with alpha), `gavel-sting-alpha.mov` (ProRes 4444 with alpha) and the last frame.

`sting.svg` animations are CSS keyframes and are switched off under `prefers-reduced-motion` (the end frame shows).
