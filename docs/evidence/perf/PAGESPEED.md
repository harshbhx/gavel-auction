# PageSpeed Insights: landing page, 10 Nov 2026

Measured by Harsh (harshbhx) by hand on the public PageSpeed Insights site, not by a CI job.

| Field         | Value                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| Date and time | 10 Nov 2026, 12:51 IST (report timestamp 12:51:28)                                      |
| URL           | https://gavel.dualmindlab.tech/                                                         |
| Tool          | PageSpeed Insights (pagespeed.web.dev), Lighthouse 13.6.0, HeadlessChromium 157         |
| Data type     | Lab data (single-page session, initial page load). Field data for real users: "No data" |

## Scores

| Form factor                                        | Performance | Accessibility | Best Practices | SEO |
| -------------------------------------------------- | ----------- | ------------- | -------------- | --- |
| Mobile (emulated Moto G Power, slow 4G throttling) | 100         | 100           | 100            | 100 |
| Desktop (emulated desktop, custom throttling)      | 100         | 100           | 100            | 100 |

## Metrics

| Metric                   | Mobile | Desktop |
| ------------------------ | ------ | ------- |
| First Contentful Paint   | 1.1 s  | 0.2 s   |
| Largest Contentful Paint | 1.1 s  | 0.2 s   |
| Total Blocking Time      | 10 ms  | 20 ms   |
| Cumulative Layout Shift  | 0      | 0       |
| Speed Index              | 2.9 s  | 0.8 s   |

## Screenshots

- Mobile: [pagespeed-mobile-2026-11-10.jpg](pagespeed-mobile-2026-11-10.jpg)
- Desktop: [pagespeed-desktop-2026-11-10.jpg](pagespeed-desktop-2026-11-10.jpg)

## Scope and limits

- The scores are for the landing page URL `/` only. They are not a score for the whole app: the room, hub, console, audit and docs pages were not measured here.
- They are one lab run on one day. PageSpeed Insights lab scores vary a little between runs, and field data (real users) is "No data" for this origin.
- The Lighthouse "Agentic browsing" panel showed 2/2 on both runs; it is not part of the four category scores above.

## Insights PageSpeed Insights still lists

A score of 100 does not mean the list is empty. On this run the report still showed:

- Render-blocking requests (mobile: estimated saving 300 ms; desktop: listed, no time shown).
- Network dependency tree.
- Use efficient cache lifetimes (desktop: estimated saving 7 KiB).
- Reduce unused CSS (about 19 KiB mobile, 18 KiB desktop).
- Reduce unused JavaScript (about 84 KiB on both).
- Avoid non-composited animations (6 animated elements) and 2 long main-thread tasks (mobile).
- Optimise DOM size and LCP breakdown (informational).

These are open follow-ups, not fixed.

## How it was reached

Merged pull requests that moved the landing page weight and layout:

- [UIX-54: remove the first-visit guided tour](https://github.com/harshbhx/gavel-auction/pull/2389)
- [FIX-107: raise first-route budget to 190 KB](https://github.com/harshbhx/gavel-auction/pull/2386) (the JavaScript bundle budget)
- [FIX-108: landing page performance, CLS and LCP](https://github.com/harshbhx/gavel-auction/pull/2390)
- [FIX-131: serve security.txt, right-size landing screenshots](https://github.com/harshbhx/gavel-auction/pull/2478) (landing image variants)

Brotli compression was enabled on the Cloudflare zone for the domain. That is a zone setting, not a change in this repository, so no pull request records it.
