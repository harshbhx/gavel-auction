# Devpost submission checklist

Checked on 8 Nov 2026. Deadline in this repo: Thu 12 Nov 2026, 12:00 PST (Fri 13 Nov 01:30 IST), internal target 12 Nov 04:00 PST (`docs/SUBMISSION.md`). This page covers the Devpost form and its assets. The overall gate table stays in [`docs/SUBMISSION.md`](../SUBMISSION.md).

Labels: **Confirmed** means read on a Devpost help page on 8 Nov 2026. **Not confirmed** means the page did not say, or it depends on the hackathon form, so check the live form.

## What could not be confirmed

- **The hackathon rules page.** No URL for the PayPal hackathon rules is in the README (it only says "Built for the PayPal Hackathon 2026"), `docs/SUBMISSION.md`, `docs/submission/*`, `docs/judges/*` or the docs site. The deadline above comes from this repo, not from a rules page. The submitter must open the hackathon page on Devpost, read the Rules tab, and check: maximum video length, whether YouTube only or YouTube and Vimeo, required fields, prize eligibility, and the exact deadline and time zone.
- **Image gallery limits.** Devpost's help pages give no pixel size, count or file size for gallery images. Only the thumbnail has stated limits. The gallery images are made at 1500x1000 (3:2) and kept under 5 MB each so they would satisfy the thumbnail limits too.
- **Video captions and resolution.** Devpost help states no rule. Plan for English captions anyway.
- **Extra fields.** Devpost says fields vary per hackathon. The list below is Devpost's generic list; the live form is the final word and is only visible when logged in and entering a submission.

## Form fields (Devpost generic, Confirmed from help.devpost.com)

Source: [Know your submission steps](https://help.devpost.com/article/126-know-your-submission-steps), [Submitting a project](https://help.devpost.com/article/84-submitting-a-project).

| Step | Field                                                     | Required                                             | Limits and rules                                                                                                                                             | Where it is drafted                                                                    |
| ---- | --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1    | Team members                                              | yes (add by email or invite link)                    | none stated                                                                                                                                                  | Submitter, on Devpost                                                                  |
| 2    | Project name                                              | yes                                                  | none stated                                                                                                                                                  | "GAVEL"                                                                                |
| 2    | Tagline                                                   | yes                                                  | none stated                                                                                                                                                  | "Every bid is a PayPal hold. The hammer is the payment." ([`DEVPOST.md`](DEVPOST.md))  |
| 2    | Thumbnail                                                 | optional in the form, needed for a good gallery card | JPG, PNG or GIF, max 5 MB, 3:2 recommended                                                                                                                   | graphics, see below                                                                    |
| 3    | Project story                                             | yes                                                  | Markdown or LaTeX allowed                                                                                                                                    | [`DEVPOST.md`](DEVPOST.md)                                                             |
| 3    | Built with tags                                           | yes                                                  | max 25 tags; tag the sponsor tool and other tech                                                                                                             | [`DEVPOST.md`](DEVPOST.md) "Built with" (OWNER line)                                   |
| 3    | Try it out links                                          | may be required                                      | hackathon specific                                                                                                                                           | below                                                                                  |
| 3    | Image gallery                                             | optional                                             | formats and size not stated (Not confirmed)                                                                                                                  | graphics, see below                                                                    |
| 3    | Video demo link                                           | usually required                                     | public on YouTube or Vimeo (Confirmed); maximum length is in the hackathon rules (Not confirmed here); processing can take minutes to hours, so upload early | [`VIDEO-SCRIPT.md`](VIDEO-SCRIPT.md), [`VIDEO-AGENT-PROMPT.md`](VIDEO-AGENT-PROMPT.md) |
| 4    | File upload                                               | optional unless required                             | max 35 MB; zip, pdf, word or apk                                                                                                                             | none needed; an A4 judge one-pager PDF is optional and not yet made                    |
| 4    | Submitter type, country of residence, category            | yes                                                  | hackathon specific                                                                                                                                           | Submitter                                                                              |
| 4    | Code repository URL                                       | yes                                                  | public; Devpost's help says MIT licence                                                                                                                      | https://github.com/harshbhx/gavel-auction (public, MIT `LICENSE`)                      |
| 4    | How you improved the project during the hackathon         | yes                                                  | hackathon specific                                                                                                                                           | [`DEVPOST.md`](DEVPOST.md) "Reuse statement" is still an OWNER line                    |
| 4    | Developer account ID, tool feedback                       | if the sponsor asks                                  | hackathon specific                                                                                                                                           | Submitter; look at the live form                                                       |
| 5    | Agree to terms and submit                                 | yes                                                  | none                                                                                                                                                         | Submitter                                                                              |
| 6    | Proofread with the View button, replace placeholder video | yes                                                  | before the deadline                                                                                                                                          | Submitter                                                                              |

Devpost also advises submitting early; when a hackathon shows a review icon on its Overview page, Devpost recommends submitting at least a week early because it checks baseline eligibility and may ask for revisions. Whether this hackathon has that icon is Not confirmed. You can edit until the deadline.

## Video rules

| Rule                                      | Status                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosted publicly on YouTube or Vimeo       | Confirmed (Devpost help); the hackathon rules may narrow it to YouTube only (Not confirmed). Use YouTube.                                                    |
| Maximum length                            | Not confirmed from the rules. The plan is 3:00 maximum, target 2:50 (`VIDEO-SCRIPT.md`). Confirm on the rules page.                                          |
| Language                                  | Not confirmed. The video is in English with English captions.                                                                                                |
| No copyrighted music or third-party marks | Not confirmed for this hackathon; a standard rule. The prompt uses no music or only royalty-free music, and no logos beyond the sponsors named in the entry. |
| Show the project working                  | Devpost advises a screencast with narration. The script uses real screens and labels anything recorded or simulated.                                         |
| Visible without login                     | Check the link in a signed-out window (`docs/SUBMISSION.md`).                                                                                                |

## What is already done

| Item                                                 | File                                                                               | Status                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Public repo, MIT licence, sandbox-only notice        | `LICENSE`, [`README.md`](../../README.md), `SECURITY.md`                           | done (`docs/SUBMISSION.md`)                                                                                          |
| Devpost story draft with real-versus-simulated table | [`docs/submission/DEVPOST.md`](DEVPOST.md)                                         | drafted; OWNER lines open (Built with, Reuse statement, Links, sandbox buyer login)                                  |
| Testing instructions for judges                      | [`docs/judges/DEVPOST-TESTING.md`](../judges/DEVPOST-TESTING.md)                   | drafted; buyer logins are placeholders by design                                                                     |
| Sandbox buyer notes                                  | [`docs/judges/SANDBOX-BUYERS.md`](../judges/SANDBOX-BUYERS.md)                     | drafted                                                                                                              |
| Trust and FAQ                                        | [`docs/judges/TRUST-FAQ.md`](../judges/TRUST-FAQ.md)                               | drafted                                                                                                              |
| Judge walkthrough                                    | [`docs/JUDGES.md`](../JUDGES.md)                                                   | done                                                                                                                 |
| Gate record (the source for every claim)             | [`docs/GATES.md`](../GATES.md), [`docs/LIMITATIONS.md`](../LIMITATIONS.md)         | G0, G1, G2, G4 PASS; G3 in progress; G5 partial                                                                      |
| Architecture diagram                                 | [`docs/submission/ARCHITECTURE.md`](ARCHITECTURE.md) (Mermaid)                     | done; the graphic version is below                                                                                   |
| Video script and shot list                           | [`docs/submission/VIDEO-SCRIPT.md`](VIDEO-SCRIPT.md)                               | script done; video not recorded                                                                                      |
| Prompt for the video agent                           | [`docs/submission/VIDEO-AGENT-PROMPT.md`](VIDEO-AGENT-PROMPT.md)                   | done in this PR                                                                                                      |
| Brand assets (logo SVGs, sting render)               | [`brand/`](../../brand/README.md)                                                  | in the repo on this branch's base; rasters and the sting video are CI artifacts of `brand-assets.yml`, not committed |
| Graphics render framework                            | [`graphics/README.md`](../../graphics/README.md), `.github/workflows/graphics.yml` | on branch `feat/GFX-01-graphics` (PR 2063)                                                                           |

## Graphics (made by the sibling GFX branches)

These paths are what the sibling agents are producing. Mark each as present or pending PR when you open it; at the time of writing none of the three folders was committed.

| Asset                                                                                                            | Path                                                         | Status              |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| README hero, architecture, lifecycle strip, outro (SVG, PNG, GIF)                                                | `docs/assets/readme/`                                        | pending PR (GFX-02) |
| Devpost gallery images (1500x1000), thumbnail, description GIFs                                                  | `docs/assets/devpost/`                                       | pending PR (GFX-03) |
| Gallery captions and alt text                                                                                    | `docs/submission/DEVPOST-IMAGES.md`                          | pending PR (GFX-03) |
| GitHub social preview 1280x640, X cards, Open Graph, LinkedIn, YouTube thumbnail 1280x720, end card, lower-third | `docs/assets/social/`                                        | pending PR (GFX-04) |
| Existing banner                                                                                                  | [`docs/assets/gavel-banner.svg`](../assets/gavel-banner.svg) | in the repo         |

Devpost's thumbnail limit is 5 MB, JPG, PNG or GIF. GIFs in the story should stay small; the size limit for images pasted in the story is Not confirmed, so keep each under 5 MB.

## What the submitter must do by hand

1. **Read the hackathon Rules tab** on Devpost and fix the unconfirmed rows above (video length, hosting, language, extra fields, exact deadline).
2. **Upload the GitHub social preview.** GitHub repo Settings, General, Social preview, upload the 1280x640 PNG from `docs/assets/social/`. It cannot be set from a commit or the API.
3. **Fill the Devpost form** in the order of the table above. Paste the story from `DEVPOST.md`, the Built with tags, the reuse statement, the repo URL, the video URL, the testing instructions.
4. **Add the sandbox buyer logins** to the Devpost testing instructions only (never to the repo): two PayPal sandbox buyers from the PayPal developer dashboard (`docs/judges/SANDBOX-BUYERS.md`). Log in once yourself first; the sandbox buyers must be US accounts and the auction runs in USD.
5. **Record and upload the video** (the video agent prompt is ready), set it public on YouTube, add captions, and check the link in a signed-out window. Upload the YouTube thumbnail from `docs/assets/social/` (YouTube needs a verified account for custom thumbnails).
6. **Upload the gallery images and the thumbnail** from `docs/assets/devpost/`, with captions from `DEVPOST-IMAGES.md`.
7. **Update the status wording after G3.** The G3 probe final reading is about 12 Nov 06:17 UTC (22:17 PST on 11 Nov), before the internal target of 12 Nov 04:00 PST (12:00 UTC). Record the result in `docs/GATES.md` first, then update the entry; if it is not recorded, word G3 as in progress.
8. **Confirm the live links** (web, docs, repo, video). `https://gavel.dualmindlab.tech` and `/try`, `/demo/scripted` answered 200 on 8 Nov 2026. The older `workers.dev` addresses in `DEVPOST.md` and `DEVPOST-TESTING.md` also answered 200; pick one set and use it everywhere. `https://api.gavel.dualmindlab.tech` is planned and pending DNS, so do not list it as live.
9. **Run the gate** `node scripts/check-submission.mjs` (or the `submit-gate` workflow) and sign `docs/SUBMISSION.md`.
10. **Submit, then save** the confirmation screenshot and URL. Check whether the page is editable after the deadline (Not confirmed).

## Honesty reminders for every field

- Sandbox only. No real money moves and no live charge is shown or claimed.
- G3 is in progress. G5 is partial and uses synthetic audio only. A full multi-bidder settlement was not run end to end on the sandbox. Crash recovery is shown on the fake PayPal plus one in-process crash on the sandbox. The APIMatic SDK is not generated yet (only the OpenAPI spec is ready).
- Sponsor claims need a source: the Render write-up and the AG Grid ledger tables are only claimable once their PRs are merged and visible on the live site.
- Label every simulated or recorded screen as such, as the entry's real-versus-simulated table does.
