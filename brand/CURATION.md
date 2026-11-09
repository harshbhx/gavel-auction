# Graphics curation

Rule (Harsh, 9 Nov): graphics only where needed. Animation (GIF, MP4, WebM, animated SVG) stays only where motion adds meaning: the logo intro, how it works, the architecture, the result moments (kill survived, ledger chain verified, live voice 24 of 24, honest latency numbers) and the outro. Everything else is a static PNG or WebP.

Nothing was deleted. Superseded animated files were moved with `git mv` into [`archive/`](archive) (see [`archive/README.md`](archive/README.md)); their static posters are the live images. The folder and file names follow `brand/<area>/<NN>-<slug>.<ext>` where the files are used in a fixed order (the Devpost description set); files already embedded in the README keep their slug names so existing links keep working.

Decisions: **keep animated**, **static only** (the poster or a PNG is used; the animated file is archived or does not exist), **archived**, **pending** (owned by another agent), **n/a** (a static asset, no decision needed).

## Devpost gallery (`brand/devpost/gallery/`)

Limits checked: JPG, PNG or GIF, 5 MB at most each, ratio 3:2. All files are 1200x800 (3:2). At most one GIF: the hero.

| Asset                                         | Kind | Decision      | Reason                                                                                  | Where used                                                                |
| --------------------------------------------- | ---- | ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `gallery/01-hero.gif` (1.3 MB)                | GIF  | keep animated | The intro: logo and promise. The only GIF in the gallery                                | Devpost gallery slot 1; copies `video/devpost-gallery/01-hero.{mp4,webm}` |
| `gallery/01-hero.png`                         | PNG  | n/a           | Fallback if the GIF is refused, also the thumbnail source                               | Devpost thumbnail, `FIELDS.md`                                            |
| `gallery/02-08-*.png` (7 files, 53 to 318 KB) | PNG  | static only   | Slides 2 to 8 read fine as stills; the animated versions of them are not in the gallery | Devpost gallery slots 2 to 8                                              |
| `devpost/thumbnail.png`                       | PNG  | n/a           | Devpost thumbnail                                                                       | Devpost form                                                              |

## Devpost description (`brand/devpost/description/`, numbered in order of appearance)

| Asset                                              | Kind      | Decision      | Reason                                                                                      | Where used                                                       |
| -------------------------------------------------- | --------- | ------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `01-banner.gif` (0.5 MB), `01-banner-poster.png`   | GIF + PNG | keep animated | Intro of the text                                                                           | `DESCRIPTION.md` line 1                                          |
| `02-inspiration.png`                               | PNG       | static only   | Mood image, no process to show (GIF `01-inspiration.gif` archived)                          | `DESCRIPTION.md` Inspiration                                     |
| `03-what-it-does.png`                              | PNG       | static only   | Four steps are animated once, in `04-how-it-works.gif` (GIF `02-what-it-does.gif` archived) | `DESCRIPTION.md` What it does                                    |
| `04-how-it-works.gif` (0.5 MB)                     | GIF       | keep animated | How it works: hold, bid, hammer, receipt in sequence                                        | `DESCRIPTION.md` Slides; videos `video/devpost-description/04-*` |
| `05-architecture.gif` (0.5 MB)                     | GIF       | keep animated | Architecture: one bid moving through four hops                                              | `DESCRIPTION.md` Slides; videos `05-*`                           |
| `06-judge-flow.png`                                | PNG       | static only   | A list of two links (GIF `slide-04-judge-flow.gif` archived)                                | `DESCRIPTION.md` Slides                                          |
| `07-audit-and-verify.gif` (0.6 MB)                 | GIF       | keep animated | Result: ledger chain verified                                                               | `DESCRIPTION.md` Slides; videos `07-*`                           |
| `08-partners.png`                                  | PNG       | static only   | Logos and names (GIF archived)                                                              | `DESCRIPTION.md` Slides                                          |
| `09-open-data-and-gates.png`                       | PNG       | static only   | Table of datasets and gates (GIF archived)                                                  | `DESCRIPTION.md` Slides                                          |
| `10-how-we-built-it.png`                           | PNG       | static only   | Stack diagram (GIF `03-how-we-built-it.gif` archived)                                       | `DESCRIPTION.md` How we built it                                 |
| `11-built-with.png`                                | PNG       | static only   | A list of tools (GIF `08-built-with.gif` archived)                                          | `DESCRIPTION.md` Built with                                      |
| `12-challenges.png`                                | PNG       | static only   | Single idea, a still shows it (GIF `04-challenges.gif` archived)                            | `DESCRIPTION.md` Challenges                                      |
| `13-results.gif` (0.3 MB), `13-results-poster.png` | GIF + PNG | keep animated | Results: kill survived, voice 24 of 24, chain verifies                                      | `DESCRIPTION.md` Accomplishments; videos `13-*`                  |
| `14-what-we-learned.png`                           | PNG       | static only   | Duplicate-event strike-out reads as a still (GIF archived)                                  | `DESCRIPTION.md` What we learned                                 |
| `15-what-is-next.png`                              | PNG       | static only   | Three lines (GIF `07-what-is-next.gif` archived)                                            | `DESCRIPTION.md` What is next                                    |
| `16-ending.gif` (0.8 MB)                           | GIF       | keep animated | The outro, until the new outro lands                                                        | `DESCRIPTION.md` Try it; videos `16-*`                           |
| `devpost/outro/` (new outro with credits)          | GIF       | pending       | Added by agent gfx-outro; will replace `16-ending.gif`, which stays as the fallback         | `DESCRIPTION.md` Try it (slot reserved in `FIELDS.md`)           |

`devpost/preview/index.html` is rebuilt from `DESCRIPTION.md` with `node brand/devpost/build-preview.mjs`.

## README (`docs/assets/readme/`, copies in `brand/readme/`)

| Asset                                                                 | Kind     | Decision              | Reason                                                                                                                  | Where used                         |
| --------------------------------------------------------------------- | -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `readme-banner{,-dark}.gif` (250 KB) + posters + `video/readme/`      | GIF      | keep animated         | Intro: logo, tagline                                                                                                    | `README.md` top                    |
| `how-it-works{,-dark}.gif` (165 KB) + posters                         | GIF      | keep animated         | How it works: four words in sequence                                                                                    | `README.md` lifecycle              |
| `readme-stats{,-dark}.gif` (180 KB) + posters                         | GIF      | keep animated         | The one results reel: live voice 24 of 24, kill survived, chain verified                                                | `README.md` What is proven         |
| `readme-footer{,-dark}.gif` (200 KB) + posters                        | GIF      | keep animated         | Outro: closing card with links                                                                                          | `README.md` bottom                 |
| `architecture-flow.gif` (345 KB)                                      | GIF      | keep animated         | Architecture motion. Not embedded in the README (it has the static `architecture-*.svg`); available for docs and embeds | Not embedded                       |
| `reel.gif` (0.7 MB), `.mp4`, `.webm`                                  | GIF      | static only, archived | Second summary loop next to banner and stats; `reel-poster.png` is used                                                 | `README.md` In 10 seconds (poster) |
| `results-latency{,-dark}.gif`                                         | GIF      | static only, archived | Superseded n=20 chart, the n=49 numbers are in the text; posters are used                                               | `README.md` latency chart (poster) |
| `hero.gif`, `outro.gif`                                               | GIF      | archived              | Same content as banner and footer                                                                                       | none (were in `EMBED.md`)          |
| `see-it-run-1..6-*.{gif,mp4,webm}` (0.4 to 0.9 MB each)               | GIF      | static only, archived | Six recordings were 3.5 MB of motion for UI screens; the PNG of each is used                                            | `README.md` See it run (PNG)       |
| `see-it-run-1..6-*.png`                                               | PNG      | n/a                   | Screenshots                                                                                                             | `README.md` See it run             |
| `architecture-*`, `lifecycle-*`, `hero-*`, `outro*` `.svg` and `.png` | SVG, PNG | n/a                   | Static diagrams                                                                                                         | `README.md`, embed notes           |
| `ALT.md`, `EMBED.md`                                                  | text     | n/a                   | Alt text and embed snippets; some entries name archived files, see the note at the top of each                          | maintainers                        |

## Motion brand and animated logo

| Asset                                                                                   | Kind            | Decision      | Reason                                                                            | Where used                  |
| --------------------------------------------------------------------------------------- | --------------- | ------------- | --------------------------------------------------------------------------------- | --------------------------- |
| `brand/logo/animated/gavel-intro-{dark,paper}.gif` + mp4, webm in `brand/video/motion/` | GIF, MP4, WebM  | keep animated | Logo intro                                                                        | Video bumpers, social, docs |
| `brand/logo/animated/gavel-outro-{dark,paper}.gif` + mp4, webm                          | GIF, MP4, WebM  | keep animated | Outro, until the new outro lands                                                  | Video bumpers, social       |
| `brand/svg/*-animated.svg`, `mark-*-loader.svg`, `sting*.svg`                           | animated SVG    | keep animated | Logo intro and loader, a few KB                                                   | Web app, docs, sting render |
| `brand/logo/3d/` (3D logo set)                                                          | video, GIF, PNG | pending       | Added by agent gfx-outro                                                          | Outro, video, Devpost       |
| `docs/assets/motion/*`                                                                  | GIF, MP4, WebM  | n/a           | Renderer output, the same files as `brand/logo/animated` and `brand/video/motion` | `graphics/motion-brand`     |
| Static logo SVGs, `brand/logo/png/*`, favicons, app icons                               | SVG, PNG        | n/a           | Static                                                                            | Web app, share previews     |

## Other sets

| Asset                                                                                                                                     | Kind    | Decision               | Reason                                                                                                                                                                                                                     | Where used                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `docs/assets/devpost/*` and `docs/assets/devpost-story/*` (GIF, MP4, WebM, posters, older `intro.gif`, `architecture.gif`, `closing.gif`) | mixed   | n/a (generator output) | Written by `graphics/devpost` and `graphics/motion-devpost-story` in CI. The curated, renamed copies are under `brand/devpost/`; nothing publishes these. Left in place because `docs/submission/*.md` still links to them | `docs/submission/DEVPOST-IMAGES.md`          |
| `docs/assets/social/*.png` (X, LinkedIn, GitHub preview, og, YouTube)                                                                     | PNG     | static only            | Share images are static by nature                                                                                                                                                                                          | Share posts, repo social preview, demo video |
| `docs/assets/social/lower-third-*-alpha.webm`                                                                                             | WebM    | keep animated          | Lower thirds for the demo video; 40 KB each                                                                                                                                                                                | Demo video                                   |
| `docs/assets/ag-grid/*.png`                                                                                                               | PNG     | static only            | Screenshots of the grid                                                                                                                                                                                                    | Docs, AG Grid write-up                       |
| `packages/web/public/landing/*.webp`                                                                                                      | WebP    | static only            | Landing screens                                                                                                                                                                                                            | Web app landing                              |
| `docsite/public` (`icon.svg`)                                                                                                             | SVG     | n/a                    | Static icon                                                                                                                                                                                                                | Docs site                                    |
| `graphics/**`                                                                                                                             | sources | n/a                    | HTML and scripts that render the sets above in CI                                                                                                                                                                          | `graphics` workflow                          |

## Counts

|                                            | Before                                                                                                                 | After                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Animated images in the README              | 11 (banner, reel, stats, how-it-works, six recordings, latency, footer; each has a dark variant except the recordings) | 4 (banner, how-it-works, stats, footer) |
| Animated images in the Devpost description | 16                                                                                                                     | 6                                       |
| GIFs in the Devpost gallery                | 1                                                                                                                      | 1 (hero)                                |

Archived with `git mv`: 18 GIF files and their MP4 and WebM siblings (see `archive/README.md`).
