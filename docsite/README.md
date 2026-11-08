# GAVEL docsite

The GAVEL documentation website. Fumadocs on Next.js (static export), Tailwind 4, Mermaid, motion,
next-themes and lucide icons, with the Holdline identity: one fixed Newsprint theme (no theme switch),
Archivo and Martian Mono, and the fill language (hatched is held, solid is charged, hollow is
released).

This folder is **not** a workspace package. It has its own `package.json` and `package-lock.json`, it
is not in the root `workspaces`, and the repository's `docs/` folder stays plain Markdown that the
docs-format checks parse. The site reads some of those files at build time (see "Generated data").

## Build and preview

Builds run in GitHub Actions (`.github/workflows/docsite.yml`): type check, static export, an
artifact named `docsite`, screenshots as the artifact `docsite-shots`, and an optional deploy to
Cloudflare Pages. Do not build on the shared 2-CPU VM.

On a machine with room for it:

```bash
cd docsite
npm ci
npm run dev      # http://localhost:3000
npm run build    # writes out/
```

## How to add a page

1. Create `content/docs/<section>/<name>.mdx` with frontmatter:

   ```mdx
   ---
   title: Page title
   description: One sentence, shown under the title and in search and social cards.
   icon: BookOpen        # a lucide icon name, optional
   status: verified      # optional sidebar badge: verified, simulated, in progress, unverified, fail, planned
   ---
   ```

2. Add the page name to the `pages` list in that section's `meta.json` (this sets the sidebar order).
3. A new section is a folder with its own `meta.json` (`title`, `icon`, `pages`) and a line in
   `content/docs/meta.json`.
4. Keep ASCII only: the repository's `check:ascii` runs on this folder too. No em dashes, no curly
   quotes.
5. Never write a live PayPal host name; the live host check scans this folder.

### Rules for content (the honesty rule)

- State what a claim rests on: a gate with evidence, the fake PayPal, a simulation, or a recording.
- A claim that was only proven against the fake PayPal or in simulation gets a `NotVerified` callout.
- Link to the file or the evidence. End how-it-works pages with a `CodePaths` list.
- A voice page says: "Speech accuracy gate G5 failed on synthetic audio."
- A placeholder that stands for an address that does not exist yet must say so in words.

### Components usable in any page without an import

| Component | Use |
| --- | --- |
| `Held`, `Charged`, `Released`, `NotVerified` | The four asides. Each has a text label, so colour is never the only signal |
| `Chip kind="fake" or "sandbox"` | Marks a code block that differs between the fake PayPal and the sandbox |
| `GateBadge id="G3"` | The status of one gate, read from `docs/GATES.md` |
| `GatesTable`, `SpeechTable`, `LatencyTable`, `SimScenarioTable` | Tables read from the repo evidence at build time |
| `CodePaths paths={[...]}` | "Where this lives in the code": links to files on GitHub |
| `SagaDiagram`, `MoneyFlowDiagram`, `VoiceDiagram`, `TimelineDiagram`, `CrashDiagram` | The five diagrams |
| Fumadocs: `Steps`, `Tabs`, `Accordions`, `Files`, `TypeTable` | Standard blocks |
| `mermaid` code fence | A Mermaid diagram, themed for the three themes |

## Diagrams

The five diagrams are inline SVG React components in `components/diagrams/`, drawn with the shared
helpers in `kit.tsx`. Colours come from CSS variables, so the three themes need no second copy. Each
figure has a `<title>`, a `<desc>`, a caption that states what it was verified against, a text
version in a `<details>` and an "Open full size" view for phones. State and event names must be the
ones in the source; when the code changes, re-check the figure against the file named in its header
comment.

## Generated data

`scripts/gen-repo-data.mjs` runs before every build and reads `docs/GATES.md` (gate status, the
speech accuracy table, the latency table) and `docs/evidence/SIM/SIM-MULTIDAY.md` (the scenarios and
the 30 day totals) into `lib/generated/repo-data.json` (git-ignored). The build fails if a table
cannot be read, rather than showing stale numbers.

## Search, llms.txt and social cards

- Search: a static index at `/api/search`, used by the search dialog.
- `/llms.txt` and `/llms-full.txt`: the page index and the full text, for tools.
- `/llms.mdx/docs/<page>/content.md`: the Markdown of one page.
- `/og/docs/<page>/image.png`: a social card per page.

## Placeholders

The public address of the site is not known yet. `lib/shared.ts` reads `NEXT_PUBLIC_SITE_URL` and
falls back to a clearly invalid placeholder address (`gavel-docs.example.invalid`) that is used only
for absolute metadata. Set the variable in the build when the Pages project exists.

## Deploy

The workflow deploys to a Cloudflare Pages project (default name `gavel-docs`, override with the
repository variable `DOCSITE_PAGES_PROJECT`) only when the secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` exist. Without them the deploy job ends green and writes a notice. The built
site is always available as the `docsite` artifact of the run, which can be published with
`wrangler pages deploy` from a machine that is logged in.

## Licenses

See `LICENSES-UI.md` for the copied-in React Bits and Magic UI components.
