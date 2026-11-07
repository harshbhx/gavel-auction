# GAVEL design: HOLDLINE

Design decisions, token reference and the libraries used. Slice S0 (tokens and base styles) is the first of a step-by-step redesign; later slices restyle screens on top of these tokens.

## Decisions

- Identity: HOLDLINE. A dark instrument surface with a brass signal, mint for charged, coral for outbid and cyan for voice status. Giant condensed price numerals.
- Themes (names only; the `data-theme` values `light`, `dark`, `projector` are unchanged): Daylight (light, bone and ink), Dusk (dark, default for the console), Floodlight (projector, forced on the public screen).
- The state rule: hatched means held, solid means charged, hollow means released. It does not depend on colour, so it survives a washed-out projector or a greyscale print.
- All token names that existed before are kept. New tokens sit beside them, so no component changes in slice S0.
- Daylight trap: brass `#FFB224` on bone or white has a contrast of 1.64 and 1.80. On Daylight brass is a fill only (`--color-signal`), and brass text or thin lines use `--color-signal-ink` (`#7A4600`, contrast 7.06). For the same reason `--color-accent` is the dark brass on Daylight and the brass signal on Dusk and Floodlight. A unit test fails any `color` or `border-color` declaration that uses `var(--color-signal)`.
- Type: Archivo variable (weight 100 to 900, width 62 to 125) for the interface and the giant numeral, Martian Mono for labels and ids. Both are self-hosted woff2, latin subset, 114 KB together, with no external request, so the CSP (`default-src 'self'`) and offline use are unaffected.
- Motion: durations unchanged (120, 240, 600 ms); easings `--ease-out`, `--ease-in-out`, `--ease-lock` added. Under `prefers-reduced-motion` the durations collapse, `--hammer-static` is 1 and every new animation class is switched off.

## Token reference

Colour (per theme, defined in `packages/web/src/design/tokens.css` for Daylight and `themes.css` for Dusk and Floodlight):

| Token                                                                                                      | Role                                                |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `--color-bg`, `--color-surface` (= `--color-panel`), `--color-panel-2`                                     | canvas, panel, raised row                           |
| `--color-fg`, `--color-fg-muted`                                                                           | text                                                |
| `--color-border`                                                                                           | control boundary (3:1)                              |
| `--color-hairline`                                                                                         | decorative separator only                           |
| `--color-accent`, `--color-on-accent`                                                                      | existing primary action pair                        |
| `--color-signal`, `--color-on-signal`, `--color-signal-ink`                                                | brass fill, text on the fill, brass as text or line |
| `--color-success` (= `--color-go`), `--color-danger` (= `--color-stop`), `--color-warning`, `--color-info` | status                                              |
| `--color-focus`                                                                                            | focus ring                                          |

Type: `--font-sans`, `--font-mono`, `--font-size-1..6` (times `--type-scale`), `--font-size-label`, `--font-size-price-phone|console|screen` (not scaled by the projector), `--line-height-title`, `--line-height-price`, `--tracking-label`, `--tracking-price`.

Space `--space-1..10`; radius `--radius-sm` 2, `--radius-md` 4, `--radius-lg` 8, `--radius-pill`, `--radius-sheet`; shadow `--shadow-1|2` (Dusk and Floodlight use an inner highlight or none).

State fills (`design/holdline.css`): `.gv-fill-held`, `.gv-fill-charged`, `.gv-fill-released`, `.gv-fill-review`. Numeral: `.gv-numeral` with `--phone`, `--console`, `--screen`, and `.gv-numeral__cents`. Label: `.gv-label`. Dot grid: `.gv-dotgrid`.

Contrast: every text token pair per theme is checked by `packages/web/test/unit/contrast.test.ts` using the WCAG 2.x relative luminance formula; the pair list is `packages/web/src/design/pairs.ts`. Body text needs 4.5, large text and UI boundaries 3.

## Libraries

| Library                                                | Used      | Licence                                     | Why                                                                                                                                |
| ------------------------------------------------------ | --------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Archivo (Omnibus-Type)                                 | yes, font | SIL OFL 1.1                                 | variable width gives the compact numeral from one file; licence file shipped in `design/fonts`                                     |
| Martian Mono (Evil Martians)                           | yes, font | SIL OFL 1.1                                 | technical label face; licence file shipped in `design/fonts`                                                                       |
| React Bits, Magic UI, Aceternity UI, shadcn/ui, Motion | not in S0 | MIT or similar, to be checked per component | S0 adds tokens only. Later slices may copy in single components (no new heavy dependency); each addition records its licence here. |

Fonts were taken from the `@fontsource-variable` packages (OFL) and committed as files; no new npm dependency was added.
