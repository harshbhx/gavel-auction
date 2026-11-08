// The guided tour: one ordered path through the docs, from "what is GAVEL" to "what is not done
// yet". It drives the tour page, the Previous/Next bar on each step, and the diagram links.
// A step is one docs page; every `href` must be a real page (checked by scripts/check-glossary.mjs
// and by the build, which fails on a dead link target in <TourSteps />).
export type TourStep = {
  n: number;
  title: string;
  /** The question this step answers, in the reader's words. */
  asks: string;
  href: string;
  /** One or two sentences: what the page gives you. */
  blurb: string;
};

export const tour: TourStep[] = [
  {
    n: 1,
    title: 'What GAVEL is',
    asks: 'What is this, and what does it promise?',
    href: '/docs/start',
    blurb: 'The one-page version: every bid is a PayPal hold, only the winning price is captured, and the status is stated plainly.',
  },
  {
    n: 2,
    title: 'Try the demo',
    asks: 'What can I run today?',
    href: '/docs/start/demo',
    blurb: 'The hosted web app, the key-less judge room and the scripted demo, with what each one shows and what it does not.',
  },
  {
    n: 3,
    title: 'The auction lifecycle',
    asks: 'What happens from hold to hammer to receipt?',
    href: '/docs/how-it-works/money-flow',
    blurb: 'Where the money is at each moment: hold, bids, hammer, capture of the winning price and release of every other hold.',
  },
  {
    n: 4,
    title: 'Verify it: audit trail and hash chain',
    asks: 'How do I check the result instead of trusting it?',
    href: '/docs/how-it-works/engine-and-ledger',
    blurb: 'The deterministic engine, the hash-chained ledger and the verifier that finds an edited entry.',
  },
  {
    n: 5,
    title: 'How it is built',
    asks: 'What are the parts?',
    href: '/docs/how-it-works/system-architecture',
    blurb: 'Web app, server, engine, payments, voice and the stores between them.',
  },
  {
    n: 6,
    title: 'Evidence and gates',
    asks: 'What is proven, and against what?',
    href: '/docs/proof/gates',
    blurb: 'Gates G0 to G5, each with its question, its result as recorded in docs/GATES.md and its limits.',
  },
  {
    n: 7,
    title: 'API reference',
    asks: 'How do I talk to the server?',
    href: '/docs/reference/websocket-protocol',
    blurb: 'The WebSocket protocol, with the data model, events and saga states beside it in the Reference tab.',
  },
  {
    n: 8,
    title: 'Hosting',
    asks: 'How is it deployed?',
    href: '/docs/run/deploy',
    blurb: 'The server on Render and the web app on Cloudflare, both in sandbox mode, and what each needs.',
  },
  {
    n: 9,
    title: 'Open datasets',
    asks: 'What data can I inspect?',
    href: '/docs/judges/open-data',
    blurb: 'Small datasets built from committed evidence for Hugging Face, each labelled for what it is.',
  },
  {
    n: 10,
    title: 'Limits and next steps',
    asks: 'What is not done?',
    href: '/docs/roadmap/limits',
    blurb: 'What GAVEL does not claim, in plain words, and what comes next.',
  },
];

export function tourStepOf(url: string): TourStep | undefined {
  return tour.find((s) => s.href === url);
}
