# Embed snippets for README.md

Paste these into the README (paths are relative to the repo root). Widths are 100% so GitHub scales them to the column. The animated GIFs sit on the paper background and read in both colour schemes; the static SVGs have light and dark variants through `prefers-color-scheme`. Visitors with reduced motion get the static PNG instead of the GIF.

## Hero (top of README, replaces docs/assets/gavel-banner.svg)

```html
<p align="center">
  <picture>
    <source
      media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: dark)"
      srcset="docs/assets/readme/hero-dark.png"
    />
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/hero-light.png" />
    <img
      src="docs/assets/readme/hero.gif"
      alt="GAVEL, the Mallet G logo, with the tagline: every bid is a PayPal hold, the hammer is the payment. A simulated lot shows bidder A captured at the winning bid and bidders B and C voided. PayPal sandbox only."
      width="100%"
    />
  </picture>
</p>
```

Static only (no animation):

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/hero-dark.svg" />
  <img
    src="docs/assets/readme/hero-light.svg"
    alt="GAVEL, the Mallet G logo, with the tagline: every bid is a PayPal hold, the hammer is the payment. PayPal sandbox only."
    width="100%"
  />
</picture>
```

## Lifecycle strip (under the pitch, before How it works)

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/lifecycle-dark.svg" />
  <img
    src="docs/assets/readme/lifecycle-light.svg"
    alt="The GAVEL lifecycle in five steps: hold, bid, hammer, receipt, verify. PayPal holds the bidder's ceiling, each bid is checked against that hold, the highest valid bid wins and pays the winning bid, other holds are voided and the result is in the ledger, and anyone can check the hash chain from the export."
    width="100%"
  />
</picture>
```

## Architecture (static, light and dark)

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/architecture-dark.svg" />
  <img
    src="docs/assets/readme/architecture-light.svg"
    alt="GAVEL architecture. A Cloudflare Worker serves the web app to the browser. The browser sends holds and bids to the Render API. The API holds, captures and voids through PayPal sandbox, which sends signed webhooks back. The API appends every step to a hash-chained ledger, and a receipt is issued that anyone can verify."
    width="100%"
  />
</picture>
```

## Architecture, animated (one bid, five steps; put it next to or inside a collapsed section)

```html
<picture>
  <source
    media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: dark)"
    srcset="docs/assets/readme/architecture-dark.png"
  />
  <source
    media="(prefers-reduced-motion: reduce)"
    srcset="docs/assets/readme/architecture-light.png"
  />
  <img
    src="docs/assets/readme/architecture-flow.gif"
    alt="Animation of one bid through GAVEL in five numbered steps: the Cloudflare Worker serves the web app, the bidder's hold and bids go to the Render API, the API asks PayPal sandbox for the hold and checks each bid against it, at the hammer the winner is captured and the other holds are voided with every step in the ledger, and a receipt is issued that anyone can verify."
    width="100%"
  />
</picture>
```

## Outro (bottom of README)

```html
<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/outro.png" />
    <img
      src="docs/assets/readme/outro.gif"
      alt="GAVEL closing card with the logo and links: repository github.com/harshbhx/gavel-auction, web app gavel.dualmindlab.tech, docs docs.gavel.dualmindlab.tech. PayPal sandbox only, no real money moves."
      width="100%"
    />
  </picture>
</p>
```

## Notes for the README owner

- The architecture shows what is deployed: the Cloudflare Worker only serves the static web app; the browser talks to the Render API directly (REST and WebSocket), so there is no Worker-to-API hop in the picture.
- The graphics do not show the planned `api.gavel.dualmindlab.tech` host.
- The hero's lot is labelled SIMULATED in the image itself.
- Alt texts are also listed in `ALT.md`.
