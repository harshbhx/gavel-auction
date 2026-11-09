# AG Grid in GAVEL

GAVEL's tables are [AG Grid](https://www.ag-grid.com/) Community edition (`ag-grid-community` and `ag-grid-react`, both MIT). There is no licence key, no watermark, and nothing from AG Grid Enterprise: every feature below is in the free edition.

## Where the grids are

| Grid         | Where                                                               | What it shows                                                       |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `LedgerGrid` | Audit page (Table / Grid switch) and the `/ledger` page             | The ledger, one row per entry. Chain status only where entries are sealed (the lab) |
| `BidsGrid`   | Auctioneer console (List / Table switch) and the `/ledger` live tab | The live bid history, newest first                                  |
| `HoldsGrid`  | The `/ledger` holds tab                                             | Holds and settlement states, with a totals row pinned at the bottom |

The code is in `packages/web/src/grid/`. The `/ledger` page (ledger lab) feeds all three from a seeded 30-day simulated run: 2,134 sealed entries, no real money and no real people.

## What each grid does

**LedgerGrid**

- Pinned number column, sorting on every column, a search box (AG Grid quick filter), per-column filters, column resize and reorder.
- Multi-row selection with checkboxes and a detail panel for the selected entry (full hash and the hash it links to).
- Export CSV (the Community CSV export, selected rows when some are selected) and Copy CSV. Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe so a spreadsheet cannot run them as formulas (a note that starts with `-` is exported with the apostrophe).
- Keyboard: Tab into the grid, arrow keys between cells, Enter selects a row, Space toggles selection.
- A chip with a word and an icon for the event and for the chain status of every row, never colour alone.
- Chain check (sealed entries only, for example the `/ledger` lab; audit-page rows carry no hash yet, so their chain status reads "Not sealed"): the grid re-hashes every entry in the browser (WebCrypto SHA-256) and compares each link with the entry before. An entry edited after sealing is marked "Edited after sealing", the row is highlighted, and the line above the grid names the first broken entry. In the lab, "Simulate an edit to entry N" changes one amount without touching the stored hash so you can watch the check find it. A `verdicts` prop lets another verifier supply the results instead.
- Under 700 px wide the table becomes one card per row (still virtualised, no sideways scroll) with a sort select.

**BidsGrid**

- New and changed bids go in with `applyTransaction` (add and update, keyed by `getRowId`), so rows that did not change are not rebuilt. Newest first. Changed cells flash, except for visitors who prefer reduced motion.
- A render that brings no change sends nothing to the grid. A component test checks both.

**HoldsGrid**

- One row per hold with a state chip (Held, Released, Charged, and the steps between). Amounts are integer cents shown as dollars, in mono numerals.
- A pinned bottom row totals what is on screen and follows the filters. A line under the toolbar says whether settled holds add up (final amount plus released equals held).

## Theming

`src/grid/theme.ts` builds one theme with the theming API: `themeQuartz.withParams({...})`, mapped to the Newsprint tokens (paper surface, ink text, hard 2 px borders, square corners, a thick ink focus ring, mono numerals through the `gv-grid-num` class). Light only. A unit test reads `tokens.css` and fails if the grid colours drift from the palette.

## Performance

Rows and columns are virtualised by AG Grid. The lab loads a 30-day run (2,134 entries): the browser draws only the visible rows, and a screen spec scrolls to the middle of the ledger and checks that fewer than 150 rows are in the page.

## Bundle

The grids are lazy. Each is behind `React.lazy`, and Vite splits the library into lazy chunks, so the landing and bidder pages do not download it. The web-budget check (`packages/web/scripts/check-size.mjs`) fails the build if AG Grid ever lands in the initial route.

## Screenshots

The `ui-screens` CI artifact has the view `grid`: ledger lab (intact, scrolled, search, detail, edited entry), holds, live bids, the audit page grid view and the console bid history, on desktop and phone.

![Ledger lab: a selected entry with its hash and the hash it links to](assets/ag-grid/ledger-detail-desktop.png)

![Holds and settlement states with a pinned totals row](assets/ag-grid/holds-desktop.png)

![Ledger lab on a phone: one card per entry, no sideways scroll](assets/ag-grid/ledger-phone.png)

## Tests

- `test/unit/ledgerModel.test.ts`: chain sealing, intact, tampered and broken results, the 30-day run.
- `test/unit/bidsModel.test.ts`: the transaction diff.
- `test/unit/gridTheme.test.ts`: theme colours match the tokens.
- `test/component/LedgerGrid.test.tsx`, `BidsGrid.test.tsx`, `HoldsGrid.test.tsx`: rows, sort, search, filter, export, pinned column, detail panel, tamper highlight, transactions, totals.
- `test/screens/grid.spec.ts`: the pictures, plus virtualisation, the marked row and no sideways scroll on a phone.

Built with [AG Grid](https://www.ag-grid.com/).
