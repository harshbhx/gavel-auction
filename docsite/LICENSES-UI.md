# UI component licenses

The documentation site copies in two small animated components. They live in
`components/home/magicui` and `components/home/reactbits`. Each file keeps a header that names its
origin. Nothing else on the site is third-party UI code; the docs framework itself (Fumadocs) is used
as a dependency, not copied.

| Component | File | Origin | License | Reduced motion |
| --- | --- | --- | --- | --- |
| Animated Beam | `components/home/magicui/animated-beam.tsx` | Magic UI, https://magicui.design | MIT | Beam is not drawn |
| Count Up | `components/home/reactbits/CountUp.tsx` | React Bits | MIT with Commons Clause | Final number is shown at once |

`components/home/reveal.tsx` (fade in on scroll) is local code and also honours reduced motion.

## About the Commons Clause

React Bits is published under the MIT license with the Commons Clause condition. The condition
forbids selling the software itself (including a product whose value derives substantially from it);
using the components inside a free documentation site is within it. The copied files keep their own
license terms even though the rest of this repository is MIT. If that is a problem for the project,
replace the one React Bits file (CountUp, about 130 lines) with local code.

## Dependencies with their own licenses

Installed from npm, not copied: Fumadocs (MIT), Next.js (MIT), React (MIT), Tailwind CSS (MIT),
motion (MIT), next-themes (MIT), lucide-react (ISC), Mermaid (MIT).

## Fonts

Archivo, Newsreader and Martian Mono are loaded from Google Fonts at build time by `next/font` and are served
from the site itself (SIL Open Font License 1.1).

The GAVEL wordmark (`components/holdline/wordmark.tsx`), the hold-resolving lot card on the home page
(`components/home/hold-resolver.tsx`), the diagrams and the page header strip are local work, drawn for this site.

## Landing page effects (`packages/web/src/ui/fx`)

The web app copies in no library code. Each effect on the marketing landing is original code that follows the idea of a public component, and the table records why.

| Effect | File | Idea from | Licence check | Decision |
| --- | --- | --- | --- | --- |
| Blur text reveal | `BlurText.tsx` | React Bits BlurText | MIT with the Commons Clause (repository LICENSE.md, read 8 Nov 2026) | Re-implemented from scratch; no React Bits code, so the clause does not attach to our files |
| Number ticker | `NumberTicker.tsx` | Magic UI Number Ticker | MIT | Re-implemented without the motion dependency |
| Marquee | `Marquee.tsx` | Magic UI Marquee | MIT | Re-implemented in CSS |
| Spotlight card | `SpotlightCard.tsx` | React Bits and Aceternity spotlight cards | Aceternity terms could not be read (its licence page was not reachable) | Re-implemented from scratch; nothing copied |
| Hero dot grid, bento grid, sticky steps, money flow, accordion, sticky bar | `landing-extra.css`, `LandingExtras.tsx`, `LandingHow.tsx` | Common marketing patterns | None needed | Local work |

All of them honour reduced motion. If a future change copies real code from Aceternity UI, read its terms first and add a row here.
