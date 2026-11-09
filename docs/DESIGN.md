# Design system: Scoreboard

The app UI follows the "P2 Scoreboard" direction: flat panels, hard offset shadows, big display numerals, a mono label voice and one clear state colour per moment. Everything lives in `packages/web/src/design` (tokens, themes, palettes) and `packages/web/src/ui` (components). Nothing in a component hard-codes a colour, size or duration.

## Files

| File                    | Purpose                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `src/design/tokens.css` | Type, space, radius, border, elevation, motion tokens; light colours (Newsprint and Signal) |
| `src/design/themes.css` | Internal dark and projector themes (not user-selectable)                                    |
| `src/design/pairs.ts`   | Every foreground and background pair the UI uses, with its minimum ratio                    |
| `src/ui/ui.css`         | Styles for the shared components                                                            |
| `src/ui/*.tsx`          | The shared components (see below)                                                           |

## Tokens

Old token names keep working: `--color-bg`, `--color-surface`, `--color-fg`, `--color-fg-muted`, `--color-border`, `--color-accent`, `--color-on-accent`, `--color-success`, `--color-warning`, `--color-danger`, `--color-focus`, `--font-sans`, `--font-size-1..6`, `--space-1..8`, `--radius-sm|md|lg|pill`, `--shadow-1|2` and the motion durations. New names are added next to them.

- Colour (added): `--color-raised`, `--color-rule`, `--color-action`, `--color-on-action`, `--color-held`, `--color-charged`, `--color-on-charged`, `--color-released`, `--color-on-danger`, `--color-ring`, `--color-sheet`, `--color-on-sheet`, `--color-win`, `--color-on-win`, `--color-out`, `--color-on-out`, `--color-shadow`, `--color-slider-fill`.
- Type: Public Sans (`--font-sans`), Big Shoulders Display (`--font-display`, prices and headings), JetBrains Mono (`--font-mono`, labels and codes). Scale 12, 14, 16, 20, 28, 40, 56, 88 px times `--type-scale` (`--font-size-1..8`). Money uses tabular numerals.
- Space: 4 px grid, `--space-1..8`.
- Radius: `--radius-sm` 2, `--radius-md` 3, `--radius-lg` 6, `--radius-sheet` 18, `--radius-pill`.
- Elevation: flat panels with hard offset shadows and no blur (`--shadow-1`, `--shadow-2`, colour from `--color-shadow`); borders `--border-width` 2 px and `--border-width-strong` 3 px.
- Motion: `--duration-micro` 120, `--duration-standard` 240, `--duration-hammer` 600, `--duration-roll` 550 ms; easings `--ease-out`, `--ease-roll`, `--ease-spring`. Under `prefers-reduced-motion` the durations collapse to 0 (80 ms opacity fade stays) and looping animations stop.

## Look

Newsprint and Signal (palette A) is fixed and is the only look: paper `#EFE6D3`, ink `#1D1712`, signal orange (text uses dark orange `#A33A06`). There is no palette or theme switch anywhere in the app, and any stored choice (for example an old `gavel.palette` in localStorage) is ignored. Night Board (B) and Salon (C) live only in the design-preview rounds, not in the code. The projector screen forces its own high-contrast theme.

## Contrast rules

Body text needs 4.5:1, large text and UI indicators 3:1 (WCAG AA). `test/unit/contrast.test.ts` checks every pair in `pairs.ts` in the three themes (light is Newsprint and Signal), and that text never equals its background. Colour is never the only signal: holds also use hatching, solid or hollow fill, and words.

## Components (`src/ui`, import from `../ui`)

- `HoldButton`: press and hold 3 seconds (`HOLD_MS`) with a progress ring; release cancels; Space and Enter also hold; a polite live region announces progress; under reduced motion the ring moves in whole seconds; `confirmAlternative` (on by default) offers two taps for people who cannot hold. A completed button stays done; remount it with a `key` to reuse it.
- `PriceRoll`: integer cents in tabular numerals; changed digits roll one by one; reduced motion swaps at once; exposes the amount as the image label.
- `HoldCard`: shows only the hold. Hatched is held, solid is charged, hollow is released, always with a text status and a hide-amount toggle.
- `CeilingSlider`: ticks every step, snaps, `role="slider"` with arrows, PageUp, PageDown, Home and End.
- `JoinCodeInput`: one slot per character, auto-advance, paste (drops a `GVL-` prefix), backspace moves back, arrows move, errors announced.
- `Loader`, `Skeleton`, `SkeletonGroup`: a labelled busy indicator and decorative placeholder blocks with one announcement.
- `StatusPill`: short status label; tone is a dot, the text carries the meaning.

## Build record (7 Nov 2026)

The redesign shipped as six slices, each one merged pull request, then extras that sit on the same tokens and components.

| Slice | Issue  | Pull request                                                 | What it covers                                                    |
| ----- | ------ | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| S0    | UIX-00 | [#1979](https://github.com/harshbhx/gavel-auction/pull/1979) | Tokens, three palettes, themes and the shared `src/ui` components |
| S1    | UIX-01 | [#1980](https://github.com/harshbhx/gavel-auction/pull/1980) | Bidder room                                                       |
| S2    | UIX-02 | [#1981](https://github.com/harshbhx/gavel-auction/pull/1981) | Auctioneer console                                                |
| S3    | UIX-03 | [#1982](https://github.com/harshbhx/gavel-auction/pull/1982) | Public projector screen                                           |
| S4    | UIX-04 | [#1983](https://github.com/harshbhx/gavel-auction/pull/1983) | Receipt as a settlement document                                  |
| S5    | UIX-05 | [#1984](https://github.com/harshbhx/gavel-auction/pull/1984) | Landing, join and register                                        |

Extras on top of the slices:

| Issue  | Pull request                                                 | What it adds                                                                                                                 |
| ------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| UX-04  | [#1991](https://github.com/harshbhx/gavel-auction/pull/1991) | Outbid, win and sold alerts, a gavel sound on the projector and a mute toggle (`src/alerts`)                                 |
| UX-01  | [#1992](https://github.com/harshbhx/gavel-auction/pull/1992) | Hold explainer sheet (`src/help`); the six-step first-visit tour from this PR was removed in UIX-54 |
| UX-02  | [#1993](https://github.com/harshbhx/gavel-auction/pull/1993) | Fundraiser thermometer on the projector screen; only captured money counts as raised                                         |
| UX-05  | [#1996](https://github.com/harshbhx/gavel-auction/pull/1996) | Shareable receipt link with QR code, copy button and print layout                                                            |
| JRM-01 | [#1965](https://github.com/harshbhx/gavel-auction/pull/1965) | The `/try` page for judge rooms (the rooms need the host flag `JUDGE_ROOMS`)                                                 |
| DH-83  | [#1994](https://github.com/harshbhx/gavel-auction/pull/1994) | Axe accessibility sweep over scripted bid, console and screen states                                                         |

Known gaps, stated plainly:

- The help layer (`HelpLayer`) is on the landing, join, register, bid and receipt routes, not on the console or the projector screen.
- `?scripted=1` (see `src/net/scriptedMode.ts`) is honoured only by development builds. The hosted production build ignores it.
- No recorded click-through of the redesigned screens against the hosted site exists, and the manual screen-reader and zoom passes in `docs/A11Y.md` have not been performed.

## Fonts and CSP

Fonts are self-hosted woff2 files under `src/design/fonts` (licences next to them) and load from the same origin, so the existing `default-src 'self'` covers them and the Content-Security-Policy is unchanged. No third-party font host is used.

## Landing effects (`src/ui/fx`)

The marketing landing uses a few small effects kept as local files in `packages/web/src/ui/fx`: a word blur reveal for the headline (BlurText), a number ticker, a text chip marquee, a pointer spotlight card, and two hooks (reduced motion, in view). They are original code in the style of React Bits, Magic UI and Aceternity UI, so no library code was copied for Aceternity. React Bits is MIT with the Commons Clause, which forbids selling the components themselves; using the idea inside this free app is within it. Per-component decisions are in `docsite/LICENSES-UI.md`.

Rules for every effect: the final state is in the markup (the headline, numbers and diagrams are readable without script), the largest paint is static text, nothing changes layout, and `prefers-reduced-motion` turns each one off (no animation class, no duplicate marquee row, final numbers at once). The page adds no dependency: the effects are CSS plus about 3 KB of gzip script. Figures on the page are only those the repository documents: 606 labelled review issues with 589 closed (docsite findings page), 40 lots and 294 holds in the simulated 30-day run (`docs/evidence/SIM/SIM-MULTIDAY.md`, shown with a dashed edge and labelled as a simulation), and 568 test and spec files (README).
