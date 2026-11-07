# UI component licenses

The documentation site copies in a few animated components, the way mealmind's docs do. They live in
`components/home/magicui` and `components/home/reactbits`. Each file keeps a header that names its
origin. Nothing else on the site is third-party UI code; the docs framework itself (Fumadocs) is used
as a dependency, not copied.

| Component | File | Origin | License | Reduced motion |
| --- | --- | --- | --- | --- |
| Animated Beam | `components/home/magicui/animated-beam.tsx` | Magic UI, https://magicui.design | MIT | Beam is not drawn |
| Border Beam | `components/home/magicui/border-beam.tsx` | Magic UI, https://magicui.design | MIT | Beam is not drawn |
| Blur Text | `components/home/reactbits/BlurText.tsx` | React Bits by David Haz, https://reactbits.dev | MIT with Commons Clause (see below) | Text is shown without the animation |
| Count Up | `components/home/reactbits/CountUp.tsx` | React Bits | MIT with Commons Clause | Final number is shown at once |
| Shiny Text | `components/home/reactbits/ShinyText.tsx` | React Bits | MIT with Commons Clause | The sweep stops (`motion-safe` only) |
| Spotlight Card | `components/home/reactbits/SpotlightCard.tsx` | React Bits | MIT with Commons Clause | The spotlight is a hover effect and has no motion loop |

`components/home/reveal.tsx` (fade in on scroll) is local code and also honours reduced motion.

## About the Commons Clause

React Bits is published under the MIT license with the Commons Clause condition. The condition
forbids selling the software itself (including a product whose value derives substantially from it);
using the components inside a free documentation site is within it. The copied files keep their own
license terms even though the rest of this repository is MIT. If that is a problem for the project,
replace the four React Bits files with local code: each is small (about 40 to 130 lines).

## Dependencies with their own licenses

Installed from npm, not copied: Fumadocs (MIT), Next.js (MIT), React (MIT), Tailwind CSS (MIT),
motion (MIT), next-themes (MIT), lucide-react (ISC), Mermaid (MIT).

## Fonts

Archivo and Martian Mono are loaded from Google Fonts at build time by `next/font` and are served
from the site itself (SIL Open Font License 1.1).
