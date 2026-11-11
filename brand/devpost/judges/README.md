# Judge guide (PDF for the Devpost judge panel)

`GAVEL-judge-guide.pdf` is the confidential guide uploaded for the judges in the Devpost judge panel. It is the hands-on and technical companion to the judge deck: the deck tells the story, this guide covers the five-minute test path, the architecture, security and ledger verification, the evidence, the APIMatic SDKs, the known limits and the contact.

The committed PDF has **placeholders only**. Every spot where a judge key, a sandbox login or a late fact belongs shows a dashed orange box such as `[JUDGE KEY: Harsh pastes here]`. The filled copy that goes to Devpost is built outside the repository and never committed.

| File                       | What it is                                                                   |
| -------------------------- | ---------------------------------------------------------------------------- |
| `judge-guide.html`         | The content. Placeholders are `<span class="ph" data-key="KEY">` elements    |
| `judge-guide.css`          | Print styles (A4), brand colours and type from `brand/tokens.json`           |
| `build.py`                 | Builds the PDF with WeasyPrint, optionally fills placeholders and draws PNGs |
| `judge-fill.template.json` | The placeholder keys, to copy outside the repository and fill                |
| `GAVEL-judge-guide.pdf`    | The built guide with placeholders (safe to commit)                           |

## Build

```bash
pip install weasyprint brotli
python3 brand/devpost/judges/build.py                  # placeholder version, written here
python3 brand/devpost/judges/build.py --png /tmp/pages  # plus one PNG per page (needs pdftoppm)
```

The fonts are the brand variable fonts in `packages/web/src/design/fonts`; `build.py` cuts static instances of the weights it needs into a temporary folder for each build.

## Fill the placeholders for Devpost

1. Copy `judge-fill.template.json` to a private folder outside the repository, for example `~/secure/judge-fill.json`, and fill the values there.
2. Build the filled copy outside the repository:

   ```bash
   python3 brand/devpost/judges/build.py --fill ~/secure/judge-fill.json --out ~/hackathon/judge-guide/GAVEL-judge-guide-filled.pdf
   ```

   The script refuses to write a filled PDF inside the repository. Any key left empty stays a visible placeholder and is listed in the output.

3. Open the filled PDF, check every page, and upload it in the Devpost judge panel.

| Key                | What goes there                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `JUDGE_KEY`        | The shared, non-expiring judge key (`gvl_judge_...`). Check it first: `POST /api/judge/key`               |
| `BUYER_A_EMAIL`    | Sandbox buyer A (wallet, the winning bidder)                                                              |
| `BUYER_A_PASSWORD` | Its sandbox password                                                                                      |
| `BUYER_B_EMAIL`    | Sandbox buyer B (wallet, spare or runner-up)                                                              |
| `BUYER_B_PASSWORD` | Its sandbox password                                                                                      |
| `BUYER_C_EMAIL`    | Sandbox buyer C (wallet paying from a sandbox test card)                                                  |
| `BUYER_C_PASSWORD` | Its sandbox password                                                                                      |
| `BUYER_D_EMAIL`    | Sandbox buyer D (wallet, the losing bidder whose hold is voided)                                          |
| `BUYER_D_PASSWORD` | Its sandbox password                                                                                      |
| `CONTACT_EMAIL`    | The email judges can write to                                                                             |
| `G3_RESULT`        | The final G3 reading (about 12 Nov 06:17 UTC); leave empty and edit the HTML to drop the line if not used |
| `SDK_RELEASE`      | Link to the `sdk-v0.0.5` GitHub release once it exists; same note as above                                |

Rules: never commit a filled PDF or a filled JSON file, never paste the values into an issue, pull request or chat, and keep the filled PDF only where the Devpost upload needs it.
