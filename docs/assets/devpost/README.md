# Devpost graphics

Poster-style set for the Devpost entry (different from the README set in `../readme/`). Sources: `graphics/devpost/`, rendered in CI by the `graphics` workflow (artifact `graphics-devpost`) with `node graphics/devpost/render.mjs <outDir>`. Upload order and caption text: [`docs/submission/DEVPOST-IMAGES.md`](../../submission/DEVPOST-IMAGES.md).

## Devpost image rules: confirmed and not confirmed

Checked 8 Nov 2026 against the Devpost Help Center article ["Know Your Submission Steps"](https://help.devpost.com/article/126-know-your-submission-steps) and a search of help.devpost.com.

Confirmed in that article:

- Project thumbnail (Project Gallery): "JPG, PNG or GIF format, 5 MB max file size". A 3:2 aspect ratio is recommended for best results, not required.
- Image Gallery: "screenshots, logos, charts, or images that support your project".
- Description: required; Markdown or LaTeX formatting is supported.
- Video: must be public on YouTube or Vimeo.
- "Built with" tags: capped at 25.

Not confirmed (the article is silent; check the hackathon's own submission form):

- A size, ratio or format rule specific to Image Gallery images (assumed JPG, PNG or GIF, 5 MB, 3:2, same as the thumbnail).
- A maximum number of gallery images (one project page we saw showed 15, which is one hackathon's form).
- Whether GIFs are accepted in the gallery (the help article only mentions GIF for the thumbnail).
- Whether and how the description editor accepts embedded images or GIFs, and any size limit for them. Fallback: link the GIF from `raw.githubusercontent.com` in Markdown, or upload it through the editor if it offers an image button.
- Character limits for the description.

## Files

All gallery PNGs are 1500x1000 (3:2) and well under 1 MB. Every file is far below the 5 MB limit. GIFs are 1000x600, 10 fps, loop forever; the largest is about 130 KB, so any plausible description limit is met. Each GIF has a `-static.png` fallback.

| File                                                                | Size      | Use                                                   |
| ------------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| `thumbnail.png`                                                     | 1500x1000 | Project thumbnail (3:2, headline readable when small) |
| `gallery-01-hero.png` to `gallery-07-open-data.png`                 | 1500x1000 | Image Gallery, in order                               |
| `intro.gif`, `architecture.gif`, `closing.gif`                      | 1000x600  | Description text                                      |
| `intro-static.png`, `architecture-static.png`, `closing-static.png` | 1000x600  | Fallback for reduced motion or if GIFs are refused    |

Honesty notes: example hashes in gallery 05 are labelled as an illustration; gallery 07 shows G3 as in progress and G5 as partial; APIMatic reads "spec ready, SDK pending"; no sponsor logos are used.
