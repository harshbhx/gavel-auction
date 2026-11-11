# Graphics sources

HTML and SVG sources for the README, Devpost and social graphics. Everything is rendered in CI by
[`graphics.yml`](../.github/workflows/graphics.yml) (never on a laptop or the VM): each folder with a
`render.mjs` is a set, rendered by `node graphics/<set>/render.mjs <outDir>` and uploaded as artifact
`graphics-<set>`. Shared theme (`lib/theme.css`) and helpers (`lib/render.mjs`) use the app fonts and the
brand colours from `brand/`.

| Set       | Output committed to    | Used by                          |
| --------- | ---------------------- | -------------------------------- |
| `readme`  | `docs/assets/readme/`  | README on GitHub                 |
| `devpost` | `docs/assets/devpost/` | Devpost gallery, thumbnail, GIFs |
| `social`  | `docs/assets/social/`  | Social cards, YouTube assets     |
| `motion-readme-set` | `brand/readme/` | README banner, flow, stats, partners, footer GIFs and PNG posters |

`motion-silent` (the silent product video) has no `render.mjs`: it is recorded and composed by
[`silent-video.yml`](../.github/workflows/silent-video.yml) and committed to `brand/video/silent-cut/`.

Update flow: edit a source, push, open the run's artifact, copy the files into the output folder and commit.
Animated pages are sampled by seeking, so a render is deterministic. Only true statements appear in any graphic
(see `docs/GATES.md`); anything simulated is labelled.
