# Devpost graphics index: used and unused

`brand/` is the single source for the Devpost entry. Nothing was deleted: GIFs that are not used any more were moved to `brand/archive/` or are listed below with their location. Where each used GIF goes on the page: [`FIELDS.md`](FIELDS.md) ("Where each GIF goes"). Why each one is animated or static: [`../CURATION.md`](../CURATION.md).

Copy-paste submission guide, field by field with character counts and the pre-submit checklist: [`DEVPOST-COPY-PASTE.md`](DEVPOST-COPY-PASTE.md). Note (11 Nov 2026): the partner images (`description/08-partners.png`, `description/11-built-with.png`, `gallery/06-partners.png`) do not name APIMatic, and `description/09-open-data-and-gates.png` and `description/15-what-is-next.png` still show G3 as RUNNING in their pixels (the text now says passed); the APIMatic SDKs are a GitHub release (`sdk-v0.0.5`), stated in the text, not in these pixels.

## Used (in the entry)

| GIF                                   | Used in                           | Role               |
| ------------------------------------- | --------------------------------- | ------------------ |
| `gallery/01-hero.gif`                 | Gallery slot 1 (only gallery GIF) | Intro              |
| `description/01-banner.gif`           | Description, first line           | Intro banner       |
| `description/04-how-it-works.gif`     | What it does                      | How it works       |
| `description/05-architecture.gif`     | How we built it                   | Architecture       |
| `description/07-audit-and-verify.gif` | Ledger verify                     | Result             |
| `description/13-results.gif`          | Accomplishments                   | Result             |
| `outro/09-outro-credits.gif`          | Try it (last image)               | Outro with credits |

MP4 and WebM of each are in `../video/devpost-description/` and `../video/devpost-gallery/`.

## Unused (kept, not deleted)

| Where                                          | What                                                                                     | Why unused                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| `../archive/devpost-description/`              | `16-ending.gif` plus MP4 and WebM (closing slide without credits)                        | Replaced by `outro/09-outro-credits.gif`    |
| `../archive/devpost-story/`                    | Earlier description loops (inspiration, what it does, challenges and others), if present | Static PNGs are used (curation, 9 Nov)      |
| `../archive/readme/`, `../archive/see-it-run/` | README reel, hero, outro, latency chart and six UI recordings                            | Posters or screenshots are used instead     |
| `docs/assets/devpost/`                         | The GFX-10 broadside set: eight slide GIFs, intro, architecture, closing, with posters   | Earlier set, superseded by `brand/devpost/` |
| `docs/assets/devpost-story/`                   | The GFX-09 story loops (banner and eight section loops)                                  | Superseded by `brand/devpost/description/`  |

The two `docs/assets/` sets stay where the renderer and the duplicate-binary check expect them; they are listed here so nothing is lost. Renderer sources: `graphics/motion-devpost/` (gallery and outro) and `graphics/motion-devpost-story/`.
