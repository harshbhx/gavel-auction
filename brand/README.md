# GAVEL brand kit

One folder for the logo, the Devpost entry (text and images), the GitHub README graphics, the social images and the videos. Files under `brand/` are copies: the originals stay in `docs/assets/` and `brand/svg/`, so existing links keep working. Every URL below is the raw file on `main`. The "Used in" column says where each group is used.

| Folder                | What is in it                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`logo/`](logo)       | Logo SVGs by background, animated logo, product icons, PNG renders (lockup light and dark, mark, favicons, share images) |
| [`logo/3d/`](logo/3d) | 3D logo set (turntable video and GIF, still angles): section below, to be added                                          |
| [`devpost/`](devpost) | Paste-ready description and form fields, gallery, story images, thumbnail, preview page                                  |
| [`readme/`](readme)   | The GitHub README graphics (GIF and poster)                                                                              |
| [`video/`](video)     | MP4 and WebM of every kept animation, each file under 10 MB; `video/silent-cut/` is the silent product video             |
| [`archive/`](archive) | Superseded animated variants (GIF, MP4, WebM), moved with `git mv`, not deleted                                          |
| [`svg/`](svg)         | The original logo SVG set and its usage guide (see "Logo reference" below)                                               |

Quick start for Devpost: open [`devpost/FIELDS.md`](devpost/FIELDS.md) for the form fields and flags, paste [`devpost/DESCRIPTION.md`](devpost/DESCRIPTION.md) into "About the project", upload `devpost/thumbnail.png` and the gallery (`devpost/gallery/01-hero.gif`, then `02` to `08` as PNG; the description images are in `devpost/description/`), and preview the result in [`devpost/preview/index.html`](devpost/preview/index.html) (open it in a browser; over http it loads the images from `main`). Rebuild the preview after editing the description: `node brand/devpost/build-preview.mjs`.

Which graphic is animated, which is static and why: see [`CURATION.md`](CURATION.md). Superseded animated files are kept in [`archive/`](archive).

## All graphics at a glance

| Graphic                                                                                        | Where it lives                                         | Used in                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Logo SVGs (static, mono, reversed, plate)                                                      | `brand/svg`, copies in `brand/logo`                    | Web app, docs site, graphics renders, slides                |
| Animated logo SVGs, sting                                                                      | `brand/logo/animated`                                  | README and docs motion, sting video                         |
| Intro and outro GIF, MP4, WebM                                                                 | `brand/logo/animated`, `brand/video/motion`            | Video bumpers, README motion set                            |
| Favicons, touch and app icons, og and twitter images                                           | `brand/logo/png`                                       | Web app head and share previews (`packages/web/index.html`) |
| README banner, stats, footer, reel, how-it-works, results                                      | `brand/readme`                                         | Root `README.md`                                            |
| README hero, outro, architecture-flow GIFs                                                     | `brand/readme`                                         | README embed notes                                          |
| README diagrams (architecture, lifecycle, hero SVG and PNG)                                    | `docs/assets/readme`                                   | Root `README.md`                                            |
| README "see it run" screenshots (six static PNGs; recordings archived)                         | `docs/assets/readme/see-it-run-*`                      | Root `README.md`                                            |
| AG Grid screenshots                                                                            | `docs/assets/ag-grid`                                  | Docs and the AG Grid sponsor write-up                       |
| Devpost gallery (hero GIF plus 7 PNGs) and thumbnail                                           | `brand/devpost/gallery`, `brand/devpost/thumbnail.png` | Devpost gallery                                             |
| Devpost description images (6 animated, 10 static, numbered)                                   | `brand/devpost/description`                            | Devpost description                                         |
| Social images (X, LinkedIn, GitHub preview, YouTube end card, thumbnails, lower thirds, chips) | `docs/assets/social`                                   | Share posts, repo social preview, demo video                |
| 3D logo set                                                                                    | `brand/logo/3d` (to be added)                          | Outro, video, Devpost                                       |

## Index of every file in the kit

### `logo/light/`

Logo for light backgrounds (ink plus orange, transparent).

Used in: Reference copy. The web app (`Logo.tsx`), the docs site and the graphics renders read `brand/svg`.

| File           | Pixels | Size | URL                                                                                         |
| -------------- | ------ | ---- | ------------------------------------------------------------------------------------------- |
| `lockup-h.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/light/lockup-h.svg |
| `lockup-v.svg` |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/light/lockup-v.svg |
| `mark.svg`     |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/light/mark.svg     |
| `wordmark.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/light/wordmark.svg |

### `logo/dark/`

Logo for dark backgrounds (paper plus orange, transparent).

Used in: Same as above, for dark surfaces.

| File           | Pixels | Size | URL                                                                                        |
| -------------- | ------ | ---- | ------------------------------------------------------------------------------------------ |
| `lockup-h.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/dark/lockup-h.svg |
| `lockup-v.svg` |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/dark/lockup-v.svg |
| `mark.svg`     |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/dark/mark.svg     |
| `wordmark.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/dark/wordmark.svg |

### `logo/mono/`

One-colour logo, black on light or white on dark or photos.

Used in: Same as above, for one-colour use.

| File                 | Pixels | Size | URL                                                                                              |
| -------------------- | ------ | ---- | ------------------------------------------------------------------------------------------------ |
| `lockup-h-black.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/mono/lockup-h-black.svg |
| `lockup-h-white.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/mono/lockup-h-white.svg |
| `lockup-v-black.svg` |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/mono/lockup-v-black.svg |
| `lockup-v-white.svg` |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/mono/lockup-v-white.svg |
| `mark-black.svg`     |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/mono/mark-black.svg     |
| `mark-white.svg`     |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/mono/mark-white.svg     |
| `wordmark-black.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/mono/wordmark-black.svg |
| `wordmark-white.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/mono/wordmark-white.svg |

### `logo/animated/`

Animated logo SVGs, sting, and intro and outro GIFs with posters.

Used in: Animated SVGs: README and docs motion, source of the sting video. Intro and outro GIFs: video bumpers and the README motion set.

| File                             | Pixels    | Size   | URL                                                                                                              |
| -------------------------------- | --------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `gavel-intro-dark-poster.png`    | 1920x1080 | 65 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/gavel-intro-dark-poster.png    |
| `gavel-intro-dark.gif`           | 960x540   | 243 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/gavel-intro-dark.gif           |
| `gavel-intro-paper-poster.png`   | 1920x1080 | 64 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/gavel-intro-paper-poster.png   |
| `gavel-intro-paper.gif`          | 960x540   | 242 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/gavel-intro-paper.gif          |
| `gavel-outro-dark-poster.png`    | 1920x1080 | 86 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/gavel-outro-dark-poster.png    |
| `gavel-outro-dark.gif`           | 960x540   | 316 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/gavel-outro-dark.gif           |
| `gavel-outro-paper-poster.png`   | 1920x1080 | 85 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/gavel-outro-paper-poster.png   |
| `gavel-outro-paper.gif`          | 960x540   | 321 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/gavel-outro-paper.gif          |
| `lockup-h-color-animated.svg`    |           | 3 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/lockup-h-color-animated.svg    |
| `lockup-h-reversed-animated.svg` |           | 3 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/lockup-h-reversed-animated.svg |
| `mark-color-animated.svg`        |           | 2 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/mark-color-animated.svg        |
| `mark-color-loader.svg`          |           | 2 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/mark-color-loader.svg          |
| `mark-reversed-animated.svg`     |           | 2 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/mark-reversed-animated.svg     |
| `mark-reversed-loader.svg`       |           | 2 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/mark-reversed-loader.svg       |
| `sting-transparent.svg`          |           | 3 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/sting-transparent.svg          |
| `sting.svg`                      |           | 3 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/animated/sting.svg                      |

### `logo/`

Product icons and share images (SVG sources).

Used in: favicon, app icons and og images are rendered to PNG in CI and served by the web app.

| File                    | Pixels | Size | URL                                                                                            |
| ----------------------- | ------ | ---- | ---------------------------------------------------------------------------------------------- |
| `app-icon-maskable.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/app-icon-maskable.svg |
| `app-icon.svg`          |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/app-icon.svg          |
| `favicon.svg`           |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/favicon.svg           |
| `og-twitter.svg`        |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/og-twitter.svg        |
| `og.svg`                |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/og.svg                |

### `logo/png/`

PNG renders of the logo SVGs (CI, `brand-assets.yml`).

Used in: Favicons and touch icons: web app head. og and twitter: share previews. Lockups and mark: slides, docs, editors.

| File                         | Pixels    | Size  | URL                                                                                                     |
| ---------------------------- | --------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `android-chrome-192x192.png` | 192x192   | 6 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/android-chrome-192x192.png |
| `android-chrome-512x512.png` | 512x512   | 15 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/android-chrome-512x512.png |
| `apple-touch-icon.png`       | 180x180   | 5 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/apple-touch-icon.png       |
| `favicon-16x16.png`          | 16x16     | 1 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/favicon-16x16.png          |
| `favicon-32x32.png`          | 32x32     | 1 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/favicon-32x32.png          |
| `favicon.ico`                |           | 15 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/favicon.ico                |
| `lockup-h-color-2048.png`    | 2048x505  | 50 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/lockup-h-color-2048.png    |
| `lockup-h-reversed-2048.png` | 2048x505  | 51 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/lockup-h-reversed-2048.png |
| `mark-color-1024.png`        | 1024x1024 | 39 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/mark-color-1024.png        |
| `maskable-512x512.png`       | 512x512   | 13 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/maskable-512x512.png       |
| `og.png`                     | 1200x630  | 19 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/og.png                     |
| `twitter.png`                | 1200x600  | 19 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/png/twitter.png                |

### `devpost/gallery/`

Devpost Image Gallery, 1200x800 (3:2). The hero is the one animated GIF; the rest are static PNGs.

Used in: Devpost gallery (hero GIF, then PNGs 02 to 08, 3:2, all under 5 MB); the hero PNG is also the thumbnail.

| File                         | Pixels   | Size   | URL                                                                                                            |
| ---------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `01-hero.gif`                | 1200x800 | 1.3 MB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/01-hero.gif                |
| `01-hero.png`                | 1200x800 | 107 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/01-hero.png                |
| `02-how-it-works.png`        | 1200x800 | 63 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/02-how-it-works.png        |
| `03-architecture.png`        | 1200x800 | 71 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/03-architecture.png        |
| `04-judge-flow.png`          | 1200x800 | 318 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/04-judge-flow.png          |
| `05-audit-and-verify.png`    | 1200x800 | 84 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/05-audit-and-verify.png    |
| `06-partners.png`            | 1200x800 | 64 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/06-partners.png            |
| `07-open-data-and-gates.png` | 1200x800 | 85 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/07-open-data-and-gates.png |
| `08-ending.png`              | 1200x800 | 53 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/08-ending.png              |

### `devpost/description/`

The images inside `devpost/DESCRIPTION.md`, numbered in the order they appear. Animated (GIF): `01-banner` intro, `04-how-it-works`, `05-architecture`, `07-audit-and-verify`, `13-results` (kill survived, voice 24 of 24, chain verifies) and `16-ending` (outro). Everything else is a static PNG. Superseded animated variants are in `archive/devpost-story/`.

Used in: Devpost description (About the project).

| File                         | Pixels   | Size   | URL                                                                                                                |
| ---------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `01-banner-poster.png`       | 1600x500 | 68 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/01-banner-poster.png       |
| `01-banner.gif`              | 1200x375 | 478 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/01-banner.gif              |
| `02-inspiration.png`         | 1000x560 | 43 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/02-inspiration.png         |
| `03-what-it-does.png`        | 1000x560 | 184 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/03-what-it-does.png        |
| `04-how-it-works.gif`        | 1200x800 | 514 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/04-how-it-works.gif        |
| `05-architecture.gif`        | 1200x800 | 532 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/05-architecture.gif        |
| `06-judge-flow.png`          | 1200x800 | 318 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/06-judge-flow.png          |
| `07-audit-and-verify.gif`    | 1200x800 | 567 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/07-audit-and-verify.gif    |
| `08-partners.png`            | 1200x800 | 64 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/08-partners.png            |
| `09-open-data-and-gates.png` | 1200x800 | 85 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/09-open-data-and-gates.png |
| `10-how-we-built-it.png`     | 1000x560 | 35 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/10-how-we-built-it.png     |
| `11-built-with.png`          | 1000x560 | 53 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/11-built-with.png          |
| `12-challenges.png`          | 1000x560 | 47 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/12-challenges.png          |
| `13-results-poster.png`      | 1000x560 | 48 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/13-results-poster.png      |
| `13-results.gif`             | 1000x560 | 315 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/13-results.gif             |
| `14-what-we-learned.png`     | 1000x560 | 38 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/14-what-we-learned.png     |
| `15-what-is-next.png`        | 1000x560 | 43 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/15-what-is-next.png        |
| `16-ending.gif`              | 1200x800 | 779 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/description/16-ending.gif              |

### `devpost/`

Devpost thumbnail and paste-ready text.

Used in: Devpost form: thumbnail, About the project, fields.

| File                | Pixels   | Size   | URL                                                                                           |
| ------------------- | -------- | ------ | --------------------------------------------------------------------------------------------- |
| `DESCRIPTION.md`    |          | 14 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/DESCRIPTION.md    |
| `FIELDS.md`         |          | 10 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/FIELDS.md         |
| `build-preview.mjs` |          | 1 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/build-preview.mjs |
| `thumbnail.png`     | 1200x800 | 107 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/thumbnail.png     |

### `devpost/preview/`

Preview of the Devpost project page, built from DESCRIPTION.md.

Used in: Preview only, not uploaded anywhere.

| File            | Pixels | Size  | URL                                                                                               |
| --------------- | ------ | ----- | ------------------------------------------------------------------------------------------------- |
| `index.html`    |        | 21 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/preview/index.html    |
| `template.html` |        | 7 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/preview/template.html |

### `readme/`

GitHub README graphics, GIF plus poster, light and dark.

Used in: Root `README.md`: banner, how-it-works, stats (the one results reel) and footer stay animated; the reel and latency chart use their poster PNGs. `architecture-flow.gif` is the animated architecture (not embedded in the README). Superseded `hero.gif`, `outro.gif`, `reel.gif` and `results-latency*.gif` are in `archive/readme/brand-copy/`.

| File                              | Pixels    | Size   | URL                                                                                                        |
| --------------------------------- | --------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `architecture-flow.gif`           | 1280x800  | 346 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/architecture-flow.gif           |
| `how-it-works-dark-poster.png`    | 1240x460  | 37 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/how-it-works-dark-poster.png    |
| `how-it-works-dark.gif`           | 1240x460  | 165 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/how-it-works-dark.gif           |
| `how-it-works-poster.png`         | 1240x460  | 37 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/how-it-works-poster.png         |
| `how-it-works.gif`                | 1240x460  | 165 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/how-it-works.gif                |
| `readme-banner-dark-poster.png`   | 1280x400  | 43 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-banner-dark-poster.png   |
| `readme-banner-dark.gif`          | 1280x400  | 254 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-banner-dark.gif          |
| `readme-banner-poster.png`        | 1280x400  | 42 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-banner-poster.png        |
| `readme-banner.gif`               | 1280x400  | 250 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-banner.gif               |
| `readme-footer-dark-poster.png`   | 1240x300  | 39 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-footer-dark-poster.png   |
| `readme-footer-dark.gif`          | 1240x300  | 198 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-footer-dark.gif          |
| `readme-footer-poster.png`        | 1240x300  | 39 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-footer-poster.png        |
| `readme-footer.gif`               | 1240x300  | 207 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-footer.gif               |
| `readme-stats-dark-poster.png`    | 1280x440  | 37 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-stats-dark-poster.png    |
| `readme-stats-dark.gif`           | 1280x440  | 176 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-stats-dark.gif           |
| `readme-stats-poster.png`         | 1280x440  | 37 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-stats-poster.png         |
| `readme-stats.gif`                | 1280x440  | 183 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/readme-stats.gif                |
| `reel-poster.png`                 | 1920x1080 | 65 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/reel-poster.png                 |
| `results-latency-dark-poster.png` | 1000x500  | 43 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/results-latency-dark-poster.png |
| `results-latency-poster.png`      | 1000x500  | 42 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/results-latency-poster.png      |

### `video/readme/`

MP4 and WebM of the README loops.

Used in: Editors, social posts and the video; same animation as `brand/readme`.

| File                      | Pixels | Size  | URL                                                                                                      |
| ------------------------- | ------ | ----- | -------------------------------------------------------------------------------------------------------- |
| `how-it-works-dark.mp4`   |        | 67 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/how-it-works-dark.mp4   |
| `how-it-works-dark.webm`  |        | 73 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/how-it-works-dark.webm  |
| `how-it-works.mp4`        |        | 67 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/how-it-works.mp4        |
| `how-it-works.webm`       |        | 73 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/how-it-works.webm       |
| `readme-banner-dark.mp4`  |        | 84 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-banner-dark.mp4  |
| `readme-banner-dark.webm` |        | 55 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-banner-dark.webm |
| `readme-banner.mp4`       |        | 81 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-banner.mp4       |
| `readme-banner.webm`      |        | 54 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-banner.webm      |
| `readme-footer-dark.mp4`  |        | 81 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-footer-dark.mp4  |
| `readme-footer-dark.webm` |        | 59 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-footer-dark.webm |
| `readme-footer.mp4`       |        | 80 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-footer.mp4       |
| `readme-footer.webm`      |        | 58 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-footer.webm      |
| `readme-stats-dark.mp4`   |        | 80 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-stats-dark.mp4   |
| `readme-stats-dark.webm`  |        | 56 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-stats-dark.webm  |
| `readme-stats.mp4`        |        | 78 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-stats.mp4        |
| `readme-stats.webm`       |        | 56 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-stats.webm       |

### `video/motion/`

MP4 and WebM of the logo intro and outro (1920x1080).

Used in: Video bumpers for the demo video and social posts.

| File                     | Pixels | Size   | URL                                                                                                     |
| ------------------------ | ------ | ------ | ------------------------------------------------------------------------------------------------------- |
| `gavel-intro-dark.mp4`   |        | 160 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/motion/gavel-intro-dark.mp4   |
| `gavel-intro-dark.webm`  |        | 79 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/motion/gavel-intro-dark.webm  |
| `gavel-intro-paper.mp4`  |        | 154 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/motion/gavel-intro-paper.mp4  |
| `gavel-intro-paper.webm` |        | 76 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/motion/gavel-intro-paper.webm |
| `gavel-outro-dark.mp4`   |        | 160 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/motion/gavel-outro-dark.mp4   |
| `gavel-outro-dark.webm`  |        | 90 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/motion/gavel-outro-dark.webm  |
| `gavel-outro-paper.mp4`  |        | 160 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/motion/gavel-outro-paper.mp4  |
| `gavel-outro-paper.webm` |        | 90 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/motion/gavel-outro-paper.webm |

### `video/devpost-gallery/`

MP4 and WebM of the one animated gallery slide, the hero.

Used in: Optional video version of the hero; not uploaded to the Devpost gallery.

| File           | Pixels | Size   | URL                                                                                                    |
| -------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------ |
| `01-hero.mp4`  |        | 356 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/01-hero.mp4  |
| `01-hero.webm` |        | 227 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/01-hero.webm |

### `video/devpost-description/`

MP4 and WebM of the animated images in the Devpost description (same numbering as `devpost/description/`).

Used in: Optional video versions of the description animations.

| File                       | Pixels | Size   | URL                                                                                                                    |
| -------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `01-banner.mp4`            |        | 177 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/01-banner.mp4            |
| `01-banner.webm`           |        | 147 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/01-banner.webm           |
| `04-how-it-works.mp4`      |        | 148 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/04-how-it-works.mp4      |
| `04-how-it-works.webm`     |        | 112 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/04-how-it-works.webm     |
| `05-architecture.mp4`      |        | 107 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/05-architecture.mp4      |
| `05-architecture.webm`     |        | 82 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/05-architecture.webm     |
| `07-audit-and-verify.mp4`  |        | 130 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/07-audit-and-verify.mp4  |
| `07-audit-and-verify.webm` |        | 91 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/07-audit-and-verify.webm |
| `13-results.mp4`           |        | 89 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/13-results.mp4           |
| `13-results.webm`          |        | 89 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/13-results.webm          |
| `16-ending.mp4`            |        | 205 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/16-ending.mp4            |
| `16-ending.webm`           |        | 140 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-description/16-ending.webm           |

## Originals not copied here

These stay where they are; the URLs are the raw files on `main`.

### `docs/assets/social/`

Social, YouTube and video-overlay images. Alt text for each is in `manifest.json`; the folder README says where each is uploaded.

Used in: Share posts, GitHub social preview (upload by the repo owner), YouTube end card and thumbnails, lower thirds and chips in the demo video.

| File                             | Size  | URL                                                                                                             |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `bug-sandbox-only-1920x1080.png` | 15 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/bug-sandbox-only-1920x1080.png |
| `bug-sandbox-only-tight.png`     | 14 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/bug-sandbox-only-tight.png     |
| `chip-recorded-1920x1080.png`    | 11 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/chip-recorded-1920x1080.png    |
| `chip-recorded.png`              | 7 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/chip-recorded.png              |
| `chip-simulated-1920x1080.png`   | 11 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/chip-simulated-1920x1080.png   |
| `chip-simulated.png`             | 6 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/chip-simulated.png             |
| `github-social-preview.png`      | 59 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/github-social-preview.png      |
| `linkedin-1200x627.png`          | 56 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/linkedin-1200x627.png          |
| `lower-third-hook-alpha.webm`    | 39 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/lower-third-hook-alpha.webm    |
| `lower-third-hook.png`           | 22 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/lower-third-hook.png           |
| `lower-third-sandbox-alpha.webm` | 44 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/lower-third-sandbox-alpha.webm |
| `lower-third-sandbox.png`        | 29 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/lower-third-sandbox.png        |
| `og-1200x630.png`                | 56 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/og-1200x630.png                |
| `x-card-1200x628.png`            | 56 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/x-card-1200x628.png            |
| `x-card-1200x675.png`            | 56 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/x-card-1200x675.png            |
| `youtube-end-card-1920x1080.png` | 76 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/youtube-end-card-1920x1080.png |
| `youtube-end-card-guides.png`    | 82 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/youtube-end-card-guides.png    |
| `youtube-thumbnail-A.png`        | 54 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/youtube-thumbnail-A.png        |
| `youtube-thumbnail-B.png`        | 48 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/social/youtube-thumbnail-B.png        |

### `docs/assets/readme/`

Diagrams and UI recordings only (the loops are copied above): `architecture-*.svg/png`, `lifecycle-*.svg/png`, `hero-*.svg/png`, `outro*.svg/png`, `see-it-run-*.png`.

Used in: Root `README.md`.

| File                          | Size   | URL                                                                                                          |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `architecture-dark.png`       | 177 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/architecture-dark.png       |
| `architecture-dark.svg`       | 144 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/architecture-dark.svg       |
| `architecture-light.png`      | 179 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/architecture-light.png      |
| `architecture-light.svg`      | 144 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/architecture-light.svg      |
| `hero-dark.png`               | 114 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/hero-dark.png               |
| `hero-dark.svg`               | 140 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/hero-dark.svg               |
| `hero-light.png`              | 114 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/hero-light.png              |
| `hero-light.svg`              | 140 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/hero-light.svg              |
| `lifecycle-dark.png`          | 82 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/lifecycle-dark.png          |
| `lifecycle-dark.svg`          | 141 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/lifecycle-dark.svg          |
| `lifecycle-light.png`         | 82 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/lifecycle-light.png         |
| `lifecycle-light.svg`         | 141 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/lifecycle-light.svg         |
| `outro-light.svg`             | 139 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/outro-light.svg             |
| `outro.png`                   | 102 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/outro.png                   |
| `see-it-run-1-start-room.png` | 364 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/see-it-run-1-start-room.png |
| `see-it-run-2-hold.png`       | 172 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/see-it-run-2-hold.png       |
| `see-it-run-3-bids.png`       | 193 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/see-it-run-3-bids.png       |
| `see-it-run-4-hammer.png`     | 204 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/see-it-run-4-hammer.png     |
| `see-it-run-5-sold.png`       | 194 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/see-it-run-5-sold.png       |
| `see-it-run-6-receipt.png`    | 224 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/readme/see-it-run-6-receipt.png    |

### `docs/assets/ag-grid/`

AG Grid screenshots.

Used in: Docs and the AG Grid write-up.

| File                        | Size   | URL                                                                                                         |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `holds-desktop.png`         | 120 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/ag-grid/holds-desktop.png         |
| `ledger-detail-desktop.png` | 220 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/ag-grid/ledger-detail-desktop.png |
| `ledger-phone.png`          | 259 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/docs/assets/ag-grid/ledger-phone.png          |

## 3D logo set (to be added)

`brand/logo/3d/` is reserved for the 3D logo: a turntable video and GIF and still angles. It is being built separately; when it merges, list each file here with its size, raw URL and where it is used (outro, video, Devpost).

| File        | Pixels | Size | Used in | URL |
| ----------- | ------ | ---- | ------- | --- |
| to be added |        |      |         |     |

## Logo reference

The logo is **The Mallet G**: a heavy circular G whose crossbar is a mallet handle ending in an orange head that stands in the counter. The wordmark is the same G at a lighter weight followed by wide monoline AVEL, like a newsprint masthead. Open [`index.html`](index.html) for the usage page.

### Colours

The logo uses the app's design tokens (`packages/web/src/design/tokens.css`), so it matches the product on paper and on ink. Also recorded in [`tokens.json`](tokens.json).

| Role          | Value                                     | App token        |
| ------------- | ----------------------------------------- | ---------------- |
| Paper         | `#efe6d3`                                 | `--color-bg`     |
| Ink           | `#1d1712`                                 | `--color-fg`     |
| Signal orange | `#ff6a1f`                                 | `--color-action` |
| One colour    | `#000` on light, `#fff` on dark or photos | none             |

Orange appears once per logo (the mallet head). Never put the colour logo on orange (use the black file) or on a busy photo (use the white file).

### Files (`svg/`)

All SVGs are outlined paths: no fonts, no text, no external references, so they render the same everywhere. Every file carries `role="img"`, a `<title>` and `aria-label` of `GAVEL`.

| Group    | Files                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Mark     | `mark-{color,black,white,reversed,plate}.svg`                                                                      |
| Wordmark | `wordmark-{color,black,white,reversed,plate}.svg`                                                                  |
| Lockups  | `lockup-h-*.svg` (horizontal), `lockup-v-*.svg` (stacked), same five variants                                      |
| Product  | `favicon.svg`, `app-icon.svg`, `app-icon-maskable.svg`, `og.svg`, `og-twitter.svg`                                 |
| Motion   | `sting.svg` (paper background), `sting-transparent.svg`                                                            |
| Animated | `mark-{color,reversed}-animated.svg`, `lockup-h-{color,reversed}-animated.svg`, `mark-{color,reversed}-loader.svg` |

Variants: `color` is ink plus orange on transparent, for paper and light surfaces. `reversed` is paper plus orange on transparent, for ink and dark surfaces. `black` and `white` are one colour. `plate` is the reversed logo on its own ink background with padding, safe on any surface.

### Clear space and minimum size

- Clear space: 0.25 x the mark height on every side (25 units on the 100 unit mark grid). Keep text and edges out of it.
- Minimum width: mark 16 px, wordmark and horizontal lockup 80 px, stacked lockup 96 px. Below 24 px use `favicon.svg` (ink tile) instead of the bare mark.
- Do not recolour, outline, rotate, stretch, add shadows, or swap the orange head for another colour.

### Construction

Mark grid 100 x 100. Ring centre (50, 50), centreline radius 39, stroke 22, from -42 degrees round the bottom to 0 degrees. Handle 13 high from x 40 to x 100. Head 16 x 34 at x 32, corner radius 3. The wordmark is cap height 100 units with hand-built polygon letters (stems 19, arms 16, tracking 12 to 14) and the G at stroke 19. The lockup scales the wordmark by 0.62 with a 26 unit gap.

### Raster set and video

Rasters and the video are rendered in CI by [`brand-assets.yml`](../.github/workflows/brand-assets.yml) (run it from the Actions tab, or open a PR that touches `brand/`), never committed:

- artifact `brand-raster`: `favicon.ico` (16, 32, 48), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180), `android-chrome-192x192.png`, `android-chrome-512x512.png`, `maskable-512x512.png`, `og.png` (1200x630), `twitter.png` (1200x600) and large PNG previews.
- artifact `brand-sting`: 3 second 1080p, 30 fps `gavel-sting-1080p.mp4` and `.webm` on paper, `gavel-sting-alpha.webm` (VP9 with alpha), `gavel-sting-alpha.mov` (ProRes 4444 with alpha) and the last frame.

`sting.svg` animations are CSS keyframes and are switched off under `prefers-reduced-motion` (the end frame shows).

### Animated logo (GFX-06)

Motion language: a confident ease. The Mallet G draws round, the handle and head arrive, the mallet winds up and strikes, a smooth round shockwave ring leaves the G, the G settles, then the wordmark glides in. No gears, no teeth, no stepped easing.

- `*-animated.svg` play once on load (about 3 seconds for the lockup, 2 for the mark). `*-loader.svg` is the mark with the mallet striking in a loop (1.6 s), for loaders.
- CSS keyframes only, no script, no fonts. Under `prefers-reduced-motion: reduce` the animation is off and the finished logo shows. In an `<img>` the media query follows the viewer's system setting.
- Use `color` on paper, `reversed` on dark. Same clear space and minimum size rules as the static files.
- Generated by `graphics/lib/motion.mjs` from the static geometry (never redrawn); see `docs/assets/GRAPHICS-NOTES.md` for how to re-render.
- Video for editors: `gavel-intro-{paper,dark}.{mp4,webm,gif}` and `gavel-outro-{paper,dark}.{mp4,webm,gif}` in `docs/assets/motion/` (1920x1080, 30 fps, 5 s; GIFs 960 px wide).
