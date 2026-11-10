# Partner marks

Third-party marks used in the launch film, unaltered, from the owners' own files.

| File                  | Owner  | Source (fetched 10 Nov 2026)                                                | Use in the film                                                                                                             |
| --------------------- | ------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `paypal-mark.svg`     | PayPal | https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg     | Payment acceptance mark in the "Built with" beat: "Payments in the PayPal sandbox. Built for the PayPal AI Hackathon 2026." |
| `paypal-wordmark.svg` | PayPal | https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-wordmark-color.svg | Beside the mark, same beat.                                                                                                 |

Rules followed: the files are PayPal's own (the ones its JS SDK serves), shown on a plain cream background, never
recoloured, skewed, cropped or animated beyond a fade and a settle; clear space at least the height of the mark on
every side; no wording that implies endorsement, only that the payments run in the PayPal sandbox and that the
project was built for the PayPal AI Hackathon 2026. Render has no public brand-asset page (render.com/brand answers
404 on 10 Nov 2026), so Render is named in type ("API hosted on Render") and no Render logo is used. The hackathon
rules say a video "must not include third party trademarks ... unless the Entrant has permission"; the PayPal mark
is used as the payment acceptance mark of a PayPal integration. Remove the two files and set `SPONSOR_LOGOS=none`
in the composer if that permission is in doubt; the beat then shows both names in type.
