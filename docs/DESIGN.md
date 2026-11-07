# Design system: Scoreboard

The app UI follows the "P2 Scoreboard" direction: flat panels, hard offset shadows, big display numerals, a mono label voice and one clear state colour per moment. Everything lives in `packages/web/src/design` (tokens, themes, palettes) and `packages/web/src/ui` (components). Nothing in a component hard-codes a colour, size or duration.

## Files

| File                      | Purpose                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/design/tokens.css`   | Type, space, radius, border, elevation and motion tokens; light theme colours (palette A)       |
| `src/design/themes.css`   | Dark (palette B) and projector (B on black, type scale 2)                                       |
| `src/design/palettes.css` | `data-pal` set to a, b or c overrides for light and dark; the projector ignores it              |
| `src/design/pairs.ts`     | Every foreground and background pair the UI uses, with its minimum ratio                        |
| `src/ui/palette.ts`       | `initPalette`, `setPalette`, `clearPalette`; the pick is kept in localStorage (`gavel.palette`) |
| `src/ui/ui.css`           | Styles for the shared components                                                                |
| `src/ui/*.tsx`            | The shared components (see below)                                                               |

## Tokens

Old token names keep working: `--color-bg`, `--color-surface`, `--color-fg`, `--color-fg-muted`, `--color-border`, `--color-accent`, `--color-on-accent`, `--color-success`, `--color-warning`, `--color-danger`, `--color-focus`, `--font-sans`, `--font-size-1..6`, `--space-1..8`, `--radius-sm|md|lg|pill`, `--shadow-1|2` and the motion durations. New names are added next to them.

- Colour (added): `--color-raised`, `--color-rule`, `--color-action`, `--color-on-action`, `--color-held`, `--color-charged`, `--color-on-charged`, `--color-released`, `--color-on-danger`, `--color-ring`, `--color-sheet`, `--color-on-sheet`, `--color-win`, `--color-on-win`, `--color-out`, `--color-on-out`, `--color-shadow`, `--color-slider-fill`.
- Type: Public Sans (`--font-sans`), Big Shoulders Display (`--font-display`, prices and headings), JetBrains Mono (`--font-mono`, labels and codes). Scale 12, 14, 16, 20, 28, 40, 56, 88 px times `--type-scale` (`--font-size-1..8`). Money uses tabular numerals.
- Space: 4 px grid, `--space-1..8`.
- Radius: `--radius-sm` 2, `--radius-md` 3, `--radius-lg` 6, `--radius-sheet` 18, `--radius-pill`.
- Elevation: flat panels with hard offset shadows and no blur (`--shadow-1`, `--shadow-2`, colour from `--color-shadow`); borders `--border-width` 2 px and `--border-width-strong` 3 px.
- Motion: `--duration-micro` 120, `--duration-standard` 240, `--duration-hammer` 600, `--duration-roll` 550 ms; easings `--ease-out`, `--ease-roll`, `--ease-spring`. Under `prefers-reduced-motion` the durations collapse to 0 (80 ms opacity fade stays) and looping animations stop.

## Palettes

| Key | Name                 | Ground and ink                        | Action                                          |
| --- | -------------------- | ------------------------------------- | ----------------------------------------------- |
| a   | Newsprint and Signal | paper `#EFE6D3`, ink `#1D1712`        | signal orange (text uses dark orange `#A33A06`) |
| b   | Night Board          | navy `#0C1624`, cream `#F0EBDD`       | mint; amber for held, coral for out             |
| c   | Salon                | ivory `#F1EBDD`, deep green `#14301F` | green; copper for held                          |

Without `data-pal`, light is A and dark is B. The projector theme is B on black, large, and ignores the switch on purpose. Put `<PaletteSwitch />` anywhere to let a person choose.

To add a palette: add a block to `palettes.css` with every `--color-*` token, add its key to `PALETTES` in `src/ui/palette.ts`, and a `ui.palette.*` entry in the copy catalog. The contrast test fails until every pair passes.

## Contrast rules

Body text needs 4.5:1, large text and UI indicators 3:1 (WCAG AA). `test/unit/contrast.test.ts` checks every pair in `pairs.ts` in the three themes and the three palettes, and that text never equals its background. Colour is never the only signal: holds also use hatching, solid or hollow fill, and words.

## Components (`src/ui`, import from `../ui`)

- `HoldButton`: press and hold 3 seconds (`HOLD_MS`) with a progress ring; release cancels; Space and Enter also hold; a polite live region announces progress; under reduced motion the ring moves in whole seconds; `confirmAlternative` (on by default) offers two taps for people who cannot hold. A completed button stays done; remount it with a `key` to reuse it.
- `PriceRoll`: integer cents in tabular numerals; changed digits roll one by one; reduced motion swaps at once; exposes the amount as the image label.
- `HoldCard`: shows only the hold. Hatched is held, solid is charged, hollow is released, always with a text status and a hide-amount toggle.
- `CeilingSlider`: ticks every step, snaps, `role="slider"` with arrows, PageUp, PageDown, Home and End.
- `JoinCodeInput`: one slot per character, auto-advance, paste (drops a `GVL-` prefix), backspace moves back, arrows move, errors announced.
- `Loader`, `Skeleton`, `SkeletonGroup`: a labelled busy indicator and decorative placeholder blocks with one announcement.
- `StatusPill`: short status label; tone is a dot, the text carries the meaning.
- `PaletteSwitch`: three buttons that call `setPalette`.

## Fonts and CSP

Fonts are self-hosted woff2 files under `src/design/fonts` (licences next to them) and load from the same origin, so the existing `default-src 'self'` covers them and the Content-Security-Policy is unchanged. No third-party font host is used.
