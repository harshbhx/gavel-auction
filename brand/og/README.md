# Link previews (Open Graph and X cards)

Every shared link to GAVEL unfurls as a 1200x630 card in the Newsprint and Signal style: paper, ink, signal orange, the GAVEL lockup, the tagline and the PayPal sandbox note.

| Surface                             | Image                                                      | Where the tags live                                                                               |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Web landing, /about, /demo/scripted | `packages/web/public/og/og-landing.png`                    | `packages/web/index.html` (static, so crawlers that skip JavaScript see it)                       |
| Judge panel /try                    | `packages/web/public/og/og-try.png`                        | `ROUTE_PREVIEWS` in `packages/web/vite.config.ts`, written to `dist/try/index.html` at build time |
| Ledger /ledger, /verify             | `packages/web/public/og/og-ledger.png`                     | same                                                                                              |
| Docs (site and home)                | `docsite/public/og/og-docs.png`                            | `docsite/lib/meta.ts`, used by `docsite/app/layout.tsx`                                           |
| Docs pages                          | `/og/docs/<page>/image.png` (drawn per page at build time) | `generateMetadata` in `docsite/app/docs/[[...slug]]/page.tsx`                                     |
| Square fallback                     | `og-square.png` (1200x1200)                                | not referenced by a tag; use it where a platform wants a square image                             |
| GitHub repo social preview          | `brand/social-preview/github-social-preview-1280x640.png`  | uploaded by hand, see below                                                                       |

## Refresh the images

The text of each card is in `og.html` (one block per card). To change a card:

1. Edit `brand/og/og.html`.
2. Open a pull request. The `og-previews` workflow renders every card with Playwright and uploads the `og-previews` artifact (it fails if a card is not the right size or is over 300 KB).
3. Download the artifact (`gh run download <run-id> -n og-previews`) and copy the PNGs: the `og-*.png` files into `packages/web/public/og/` and `docsite/public/og/`, `github-social-preview-1280x640.png` into `brand/social-preview/`, `apple-touch-icon.png` into `docsite/public/`.

Nothing is rendered on a laptop. Tests: `packages/web/test/unit/linkPreviews.test.ts` (web) and `docsite/scripts/check-meta.mjs` (run by the docsite workflow on the built export) fail when a page lacks `og:image`, `twitter:card` or any sibling tag.

## GitHub repo social preview (manual)

GitHub has no API for it. Repo owner: Settings, General, Social preview, Edit, Upload an image, choose `brand/social-preview/github-social-preview-1280x640.png`.

## After a deploy: clear the platform caches

Platforms cache a card for days. Re-scrape after a change:

- Open Graph checker: https://www.opengraph.xyz/
- LinkedIn Post Inspector: https://www.linkedin.com/post-inspector/
- Facebook Sharing Debugger (also refreshes WhatsApp, Instagram): https://developers.facebook.com/tools/debug/
- X has no validator any more: paste the link in a draft post to see the card. X refreshes its cache on its own after about a week.
