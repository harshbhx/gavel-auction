# GAVEL brand kit

One folder for the logo, the Devpost entry (text and images), the GitHub README graphics and the videos. Every file here is a copy: the originals stay in `docs/assets/` and `brand/svg/`, so existing links keep working. Every URL below is the raw file on `main`.

| Folder                | What is in it                                                                           |
| --------------------- | --------------------------------------------------------------------------------------- |
| [`logo/`](logo)       | Logo SVGs by background, animated logo, product icons, PNG renders                      |
| [`devpost/`](devpost) | Paste-ready description and form fields, gallery, story images, thumbnail, preview page |
| [`readme/`](readme)   | The GitHub README graphics (GIF and poster)                                             |
| [`video/`](video)     | MP4 and WebM of every animation above, each file under 10 MB                            |
| [`svg/`](svg)         | The original logo SVG set and its usage guide (see "Logo reference" below)              |

Quick start for Devpost: open [`devpost/FIELDS.md`](devpost/FIELDS.md) for the form fields, paste [`devpost/DESCRIPTION.md`](devpost/DESCRIPTION.md) into "About the project", upload `devpost/thumbnail.png` and `devpost/gallery/01` to `08` (PNG), and preview the result in [`devpost/preview/index.html`](devpost/preview/index.html) (open it in a browser; served from the repo, it loads the images from `main`).

Not copied (already organised elsewhere): `docs/assets/social/` (X, LinkedIn, YouTube and GitHub share images with a manifest), `docs/assets/readme/see-it-run-*` (six UI recordings), `docs/assets/ag-grid/`, and the architecture and lifecycle diagrams in `docs/assets/readme/`.

Rebuild the preview after editing the description: `node brand/devpost/build-preview.mjs`.

## Index of every file

### `logo/light/`

Logo for light backgrounds (ink plus orange, transparent).

| File           | Pixels | Size | URL                                                                                         |
| -------------- | ------ | ---- | ------------------------------------------------------------------------------------------- |
| `lockup-h.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/light/lockup-h.svg |
| `lockup-v.svg` |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/light/lockup-v.svg |
| `mark.svg`     |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/light/mark.svg     |
| `wordmark.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/light/wordmark.svg |

### `logo/dark/`

Logo for dark backgrounds (paper plus orange, transparent).

| File           | Pixels | Size | URL                                                                                        |
| -------------- | ------ | ---- | ------------------------------------------------------------------------------------------ |
| `lockup-h.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/dark/lockup-h.svg |
| `lockup-v.svg` |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/dark/lockup-v.svg |
| `mark.svg`     |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/dark/mark.svg     |
| `wordmark.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/dark/wordmark.svg |

### `logo/mono/`

One-colour logo, black on light or white on dark or photos.

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

Animated logo (SVG, plays once or loops), sting, and intro and outro GIFs with posters.

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

| File                    | Pixels | Size | URL                                                                                            |
| ----------------------- | ------ | ---- | ---------------------------------------------------------------------------------------------- |
| `app-icon-maskable.svg` |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/app-icon-maskable.svg |
| `app-icon.svg`          |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/app-icon.svg          |
| `favicon.svg`           |        | 1 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/favicon.svg           |
| `og-twitter.svg`        |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/og-twitter.svg        |
| `og.svg`                |        | 2 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/logo/og.svg                |

### `devpost/gallery/`

Devpost Image Gallery, 1200x800 (3:2). Upload the PNGs in file order; the GIFs are animated versions.

| File                         | Pixels   | Size   | URL                                                                                                            |
| ---------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `01-hero.gif`                | 1200x800 | 1.3 MB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/01-hero.gif                |
| `01-hero.png`                | 1200x800 | 107 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/01-hero.png                |
| `02-how-it-works.gif`        | 1200x800 | 514 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/02-how-it-works.gif        |
| `02-how-it-works.png`        | 1200x800 | 63 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/02-how-it-works.png        |
| `03-architecture.gif`        | 1200x800 | 532 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/03-architecture.gif        |
| `03-architecture.png`        | 1200x800 | 71 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/03-architecture.png        |
| `04-judge-flow.gif`          | 1200x800 | 788 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/04-judge-flow.gif          |
| `04-judge-flow.png`          | 1200x800 | 318 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/04-judge-flow.png          |
| `05-audit-and-verify.gif`    | 1200x800 | 567 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/05-audit-and-verify.gif    |
| `05-audit-and-verify.png`    | 1200x800 | 84 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/05-audit-and-verify.png    |
| `06-partners.gif`            | 1200x800 | 605 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/06-partners.gif            |
| `06-partners.png`            | 1200x800 | 64 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/06-partners.png            |
| `07-open-data-and-gates.gif` | 1200x800 | 563 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/07-open-data-and-gates.gif |
| `07-open-data-and-gates.png` | 1200x800 | 85 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/07-open-data-and-gates.png |
| `08-ending.gif`              | 1200x800 | 779 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/08-ending.gif              |
| `08-ending.png`              | 1200x800 | 53 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/gallery/08-ending.png              |

### `devpost/story/`

Images for the Devpost description, GIF plus poster PNG. Put the banner at the top.

| File                            | Pixels   | Size   | URL                                                                                                             |
| ------------------------------- | -------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `00-story-banner-poster.png`    | 1600x500 | 68 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/00-story-banner-poster.png    |
| `00-story-banner.gif`           | 1200x375 | 478 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/00-story-banner.gif           |
| `01-inspiration-poster.png`     | 1000x560 | 43 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/01-inspiration-poster.png     |
| `01-inspiration.gif`            | 1000x560 | 232 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/01-inspiration.gif            |
| `02-what-it-does-poster.png`    | 1000x560 | 184 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/02-what-it-does-poster.png    |
| `02-what-it-does.gif`           | 1000x560 | 542 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/02-what-it-does.gif           |
| `03-how-we-built-it-poster.png` | 1000x560 | 35 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/03-how-we-built-it-poster.png |
| `03-how-we-built-it.gif`        | 1000x560 | 255 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/03-how-we-built-it.gif        |
| `04-challenges-poster.png`      | 1000x560 | 47 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/04-challenges-poster.png      |
| `04-challenges.gif`             | 1000x560 | 291 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/04-challenges.gif             |
| `05-accomplishments-poster.png` | 1000x560 | 48 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/05-accomplishments-poster.png |
| `05-accomplishments.gif`        | 1000x560 | 315 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/05-accomplishments.gif        |
| `06-what-we-learned-poster.png` | 1000x560 | 38 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/06-what-we-learned-poster.png |
| `06-what-we-learned.gif`        | 1000x560 | 219 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/06-what-we-learned.gif        |
| `07-what-is-next-poster.png`    | 1000x560 | 43 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/07-what-is-next-poster.png    |
| `07-what-is-next.gif`           | 1000x560 | 262 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/07-what-is-next.gif           |
| `08-built-with-poster.png`      | 1000x560 | 53 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/08-built-with-poster.png      |
| `08-built-with.gif`             | 1000x560 | 304 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/story/08-built-with.gif             |

### `devpost/`

Devpost thumbnail and paste-ready text.

| File                | Pixels   | Size   | URL                                                                                           |
| ------------------- | -------- | ------ | --------------------------------------------------------------------------------------------- |
| `DESCRIPTION.md`    |          | 11 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/DESCRIPTION.md    |
| `FIELDS.md`         |          | 7 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/FIELDS.md         |
| `build-preview.mjs` |          | 1 KB   | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/build-preview.mjs |
| `thumbnail.png`     | 1200x800 | 107 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/thumbnail.png     |

### `devpost/preview/`

Preview page of the Devpost project page, rendered from DESCRIPTION.md.

| File            | Pixels | Size  | URL                                                                                               |
| --------------- | ------ | ----- | ------------------------------------------------------------------------------------------------- |
| `index.html`    |        | 18 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/preview/index.html    |
| `template.html` |        | 7 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/devpost/preview/template.html |

### `readme/`

GitHub README banners, stats, footer, reel and diagram loops, GIF plus poster.

| File                              | Pixels    | Size   | URL                                                                                                        |
| --------------------------------- | --------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `architecture-flow.gif`           | 1280x800  | 346 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/architecture-flow.gif           |
| `hero.gif`                        | 1280x440  | 273 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/hero.gif                        |
| `how-it-works-dark-poster.png`    | 1240x460  | 37 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/how-it-works-dark-poster.png    |
| `how-it-works-dark.gif`           | 1240x460  | 165 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/how-it-works-dark.gif           |
| `how-it-works-poster.png`         | 1240x460  | 37 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/how-it-works-poster.png         |
| `how-it-works.gif`                | 1240x460  | 165 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/how-it-works.gif                |
| `outro.gif`                       | 1280x480  | 193 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/outro.gif                       |
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
| `reel.gif`                        | 960x540   | 734 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/reel.gif                        |
| `results-latency-dark-poster.png` | 1000x500  | 43 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/results-latency-dark-poster.png |
| `results-latency-dark.gif`        | 1000x500  | 96 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/results-latency-dark.gif        |
| `results-latency-poster.png`      | 1000x500  | 42 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/results-latency-poster.png      |
| `results-latency.gif`             | 1000x500  | 96 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/readme/results-latency.gif             |

### `video/readme/`

MP4 and WebM of the README loops.

| File                      | Pixels | Size   | URL                                                                                                      |
| ------------------------- | ------ | ------ | -------------------------------------------------------------------------------------------------------- |
| `how-it-works-dark.mp4`   |        | 67 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/how-it-works-dark.mp4   |
| `how-it-works-dark.webm`  |        | 73 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/how-it-works-dark.webm  |
| `how-it-works.mp4`        |        | 67 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/how-it-works.mp4        |
| `how-it-works.webm`       |        | 73 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/how-it-works.webm       |
| `readme-banner-dark.mp4`  |        | 84 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-banner-dark.mp4  |
| `readme-banner-dark.webm` |        | 55 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-banner-dark.webm |
| `readme-banner.mp4`       |        | 81 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-banner.mp4       |
| `readme-banner.webm`      |        | 54 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-banner.webm      |
| `readme-footer-dark.mp4`  |        | 81 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-footer-dark.mp4  |
| `readme-footer-dark.webm` |        | 59 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-footer-dark.webm |
| `readme-footer.mp4`       |        | 80 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-footer.mp4       |
| `readme-footer.webm`      |        | 58 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-footer.webm      |
| `readme-stats-dark.mp4`   |        | 80 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-stats-dark.mp4   |
| `readme-stats-dark.webm`  |        | 56 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-stats-dark.webm  |
| `readme-stats.mp4`        |        | 78 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-stats.mp4        |
| `readme-stats.webm`       |        | 56 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/readme-stats.webm       |
| `reel.mp4`                |        | 239 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/reel.mp4                |
| `reel.webm`               |        | 175 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/readme/reel.webm               |

### `video/motion/`

MP4 and WebM of the logo intro and outro (1920x1080).

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

MP4 and WebM of the eight animated gallery slides.

| File                          | Pixels | Size   | URL                                                                                                                   |
| ----------------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `01-hero.mp4`                 |        | 356 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/01-hero.mp4                 |
| `01-hero.webm`                |        | 227 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/01-hero.webm                |
| `02-how-it-works.mp4`         |        | 148 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/02-how-it-works.mp4         |
| `02-how-it-works.webm`        |        | 112 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/02-how-it-works.webm        |
| `03-architecture.mp4`         |        | 107 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/03-architecture.mp4         |
| `03-architecture.webm`        |        | 82 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/03-architecture.webm        |
| `04-judge-flow.mp4`           |        | 234 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/04-judge-flow.mp4           |
| `04-judge-flow.webm`          |        | 159 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/04-judge-flow.webm          |
| `05-audit-and-verify.mp4`     |        | 130 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/05-audit-and-verify.mp4     |
| `05-audit-and-verify.webm`    |        | 91 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/05-audit-and-verify.webm    |
| `06-partners.mp4`             |        | 170 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/06-partners.mp4             |
| `06-partners.webm`            |        | 143 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/06-partners.webm            |
| `07-open-data-and-gates.mp4`  |        | 131 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/07-open-data-and-gates.mp4  |
| `07-open-data-and-gates.webm` |        | 91 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/07-open-data-and-gates.webm |
| `08-ending.mp4`               |        | 205 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/08-ending.mp4               |
| `08-ending.webm`              |        | 140 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-gallery/08-ending.webm              |

### `video/devpost-story/`

MP4 and WebM of the nine description loops.

| File                      | Pixels | Size   | URL                                                                                                             |
| ------------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| `00-story-banner.mp4`     |        | 177 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/00-story-banner.mp4     |
| `00-story-banner.webm`    |        | 147 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/00-story-banner.webm    |
| `01-inspiration.mp4`      |        | 75 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/01-inspiration.mp4      |
| `01-inspiration.webm`     |        | 75 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/01-inspiration.webm     |
| `02-what-it-does.mp4`     |        | 177 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/02-what-it-does.mp4     |
| `02-what-it-does.webm`    |        | 164 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/02-what-it-does.webm    |
| `03-how-we-built-it.mp4`  |        | 81 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/03-how-we-built-it.mp4  |
| `03-how-we-built-it.webm` |        | 75 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/03-how-we-built-it.webm |
| `04-challenges.mp4`       |        | 97 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/04-challenges.mp4       |
| `04-challenges.webm`      |        | 92 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/04-challenges.webm      |
| `05-accomplishments.mp4`  |        | 89 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/05-accomplishments.mp4  |
| `05-accomplishments.webm` |        | 89 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/05-accomplishments.webm |
| `06-what-we-learned.mp4`  |        | 67 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/06-what-we-learned.mp4  |
| `06-what-we-learned.webm` |        | 75 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/06-what-we-learned.webm |
| `07-what-is-next.mp4`     |        | 72 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/07-what-is-next.mp4     |
| `07-what-is-next.webm`    |        | 79 KB  | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/07-what-is-next.webm    |
| `08-built-with.mp4`       |        | 127 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/08-built-with.mp4       |
| `08-built-with.webm`      |        | 115 KB | https://raw.githubusercontent.com/harshbhx/gavel-auction/main/brand/video/devpost-story/08-built-with.webm      |

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
