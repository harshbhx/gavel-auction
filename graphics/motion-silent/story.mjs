// The story of the silent cut: scene order, panes, captions and cards. Every statement comes from
// docs/GATES.md, docs/evidence or the recorded app; anything simulated is labelled.
// Times: a and b are seconds from the scene start (b: 'end' means until the scene ends). With `at`,
// they are relative to that recorded event instead (events are named instants inside a shot).
// A shot scene shows the recorded window of `shot`: from (seconds into the shot), target (the scene is
// fast-forwarded to fit this many seconds, at most 2.4x), dur (seconds, default the rest of the shot),
// speed (fixed fast-forward factor).
//
// panes: items { src, w | h, label } laid out in a row, centred in the 1280x720 window; an item can be
// { stack: [ {src, w, label}, ... ] } for panes above each other.

export const SCENES = [
  {
    id: 'title',
    kind: 'card',
    card: 'title',
    dur: 5,
    lines: [{ a: 1.2, b: 5, text: 'GAVEL. Every bid is a hold. The hammer is the payment.' }],
  },
  {
    id: 'problem',
    kind: 'card',
    card: 'problem',
    dur: 8.4,
    lines: [
      { a: 0.7, b: 3.3, text: 'Charge a card up front, and bidders hold back.' },
      { a: 3.3, b: 5.9, text: 'Leave bids unsecured, and winners walk away.' },
      { a: 5.9, b: 8.4, text: 'Shout bids on paper sheets, and the record is hard to trust.' },
    ],
  },
  {
    id: 'try',
    kind: 'shot',
    shot: 'try',
    step: 0,
    target: 5.5,
    panes: [{ src: 'host', w: 1280, label: 'Judge. Sandbox page /try' }],
    caps: [
      {
        a: 0.4,
        b: 'end',
        text: 'A judge opens <em>/try</em>.',
        sub: 'One tap starts a sandbox room.',
      },
    ],
  },
  {
    id: 'hub',
    kind: 'shot',
    shot: 'hub',
    step: 0,
    target: 5.5,
    panes: [{ src: 'host', w: 1280, label: 'Room hub' }],
    caps: [{ a: 0.3, b: 'end', text: 'A <em>join code</em> and a ticket <em>QR</em>.' }],
  },
  {
    id: 'joinA',
    kind: 'shot',
    shot: 'joinA',
    step: 1,
    target: 8,
    panes: [
      { src: 'host', w: 860, label: 'Hub' },
      { src: 'phoneA', h: 700, label: 'Bidder A. Phone' },
    ],
    caps: [
      {
        a: 0.3,
        b: 'end',
        text: 'A bidder types the <em>code</em>.',
        sub: 'Or scans the ticket QR.',
      },
    ],
  },
  {
    id: 'holdA',
    kind: 'shot',
    shot: 'holdA',
    step: 1,
    target: 13,
    panes: [
      { src: 'screen', w: 860, label: 'Big screen' },
      { src: 'phoneA', h: 700, label: 'Bidder A. Phone' },
    ],
    caps: [
      { a: 0.3, b: 'next', text: 'Pick a <em>ceiling</em>.', sub: 'The most this bidder may bid.' },
      { at: 'holdA.press', a: -0.4, b: 'next', text: 'Hold the button <em>3 seconds</em>.' },
      { at: 'holdA.released', a: -0.1, b: 'end', text: '<em>Held</em>, not charged.' },
    ],
  },
  {
    id: 'joinB',
    kind: 'shot',
    shot: 'joinB',
    step: 1,
    target: 7,
    panes: [
      { src: 'phoneA', h: 560, label: 'Bidder A' },
      { src: 'phoneB', h: 700, label: 'Bidder B. Joins from the QR link' },
    ],
    caps: [{ a: 0.3, b: 'end', text: 'A second phone joins from the <em>QR link</em>.' }],
  },
  {
    id: 'open',
    kind: 'shot',
    shot: 'open',
    step: 2,
    target: 4.5,
    panes: [{ src: 'console', w: 1280, label: 'Auctioneer console' }],
    caps: [{ a: 0.3, b: 'end', text: 'The auctioneer <em>opens the lot</em>.' }],
  },
  {
    id: 'bids',
    kind: 'shot',
    shot: 'bids',
    step: 2,
    target: 10,
    panes: [
      { src: 'phoneA', h: 700, label: 'Bidder A' },
      { src: 'phoneB', h: 700, label: 'Bidder B' },
      {
        stack: [
          { src: 'screen', w: 582, label: 'Big screen' },
          { src: 'console', w: 582, label: 'Console' },
        ],
      },
    ],
    caps: [
      { at: 'bids.first', a: -0.3, b: 'next', text: '<em>Bids</em> arrive from the phones.' },
      { at: 'bids.second', a: 0.1, b: 'next', text: 'Prices only go <em>up</em>.' },
      { at: 'bids.third', a: 0.1, b: 'end', text: 'Every screen <em>agrees</em>.' },
    ],
  },
  {
    id: 'hammer',
    kind: 'shot',
    shot: 'hammer',
    step: 3,
    target: 9.5,
    panes: [{ src: 'console', w: 1280, label: 'Auctioneer console' }],
    caps: [
      {
        a: 0.3,
        b: 'next',
        text: 'Hold the <em>hammer</em> 3 seconds.',
        sub: 'No accidental sales.',
      },
      { at: 'hammer.released', a: 0.3, b: 'end', text: '<em>Sold.</em>' },
    ],
  },
  {
    id: 'sold',
    kind: 'shot',
    shot: 'sold',
    step: 3,
    target: 3.2,
    panes: [{ src: 'screen', w: 1280, label: 'Big screen' }],
    caps: [{ a: 0.2, b: 'end', text: 'The big screen <em>names</em> the winner.' }],
  },
  {
    id: 'receipt',
    kind: 'shot',
    shot: 'receipt',
    step: 4,
    target: 7.5,
    panes: [
      { src: 'phoneA', h: 700, label: 'Bidder A' },
      { src: 'phoneB', h: 700, label: 'Bidder B' },
    ],
    caps: [
      { a: 0.3, b: 4.2, text: 'A <em>receipt</em> for every bidder.' },
      { a: 4.4, b: 'end', text: 'With a share link and a QR.' },
    ],
  },
  {
    id: 'verify',
    kind: 'shot',
    shot: 'verify',
    step: 5,
    target: 10,
    panes: [{ src: 'host', w: 1280, label: 'Verify a ledger' }],
    caps: [
      { a: 0.3, b: 'next', text: 'Paste a ledger <em>export</em>.' },
      { at: 'verify.clicked', a: -0.2, b: 'next', text: 'Chain <em>verified</em>.' },
      {
        at: 'verify.edit',
        a: 0,
        b: 'end',
        text: 'Edit one entry.',
        sub: 'The chain marks it broken.',
      },
    ],
  },
  {
    id: 'evidence',
    kind: 'card',
    card: 'evidence',
    dur: 12.5,
    lines: [
      {
        a: 0.6,
        b: 3.6,
        text: 'Kill survived. A real server kill during settlement, on the PayPal sandbox: one capture, two holds voided, a ledger of 19 entries that verifies.',
      },
      {
        a: 3.6,
        b: 6.6,
        text: 'Live voice 24 of 24. Both speech providers answered 24 of 24 synthetic clips through the live socket. No bid accepted without a confirm.',
      },
      {
        a: 6.6,
        b: 9.6,
        text: 'Ledger verified. Every bid joins a hash chain. Anyone can check it again, and an edited entry is marked.',
      },
      {
        a: 9.6,
        b: 12.5,
        text: 'Latency, honestly. Hammer to captured p95 3.8 s against a 2.5 s target. Hammer to settled p95 6.9 s against 6 s. Both missed.',
      },
    ],
  },
  {
    id: 'lab',
    kind: 'shot',
    shot: 'lab',
    step: 5,
    target: 7.5,
    panes: [{ src: 'host', w: 1280, label: 'Ledger lab. AG Grid' }],
    caps: [
      {
        a: 0.3,
        b: 'next',
        text: 'The <em>ledger lab</em>.',
        sub: 'A 30 day simulated ledger in an AG Grid table.',
      },
      {
        at: 'lab.tampered',
        a: -1,
        b: 'end',
        text: 'Edit one entry and the chain <em>marks it</em>.',
      },
    ],
  },
  {
    id: 'api',
    kind: 'card',
    card: 'api',
    dur: 8.5,
    lines: [
      {
        a: 0.5,
        b: 8.5,
        text: 'A key. HTTP. JSON. Create a room, bid and read the ledger from the Judge API.',
      },
    ],
  },
  {
    id: 'docs',
    kind: 'shot',
    shot: 'docs',
    step: 0,
    target: 4.5,
    panes: [{ src: 'docs', w: 1280, label: 'docs.gavel.dualmindlab.tech' }],
    caps: [{ a: 0.3, b: 'end', text: 'The docs list <em>every call</em>.' }],
  },
  {
    id: 'status',
    kind: 'card',
    card: 'open',
    dur: 8.2,
    lines: [
      {
        a: 0.6,
        b: 3.1,
        text: 'G3 in progress. The honor-period probe is still timing. The final reading is about 12 Nov.',
      },
      {
        a: 3.1,
        b: 5.6,
        text: 'G5 partial. Speech is measured on synthetic, noise-free audio only.',
      },
      { a: 5.6, b: 8.2, text: 'Sandbox only. No real money moves.' },
    ],
  },
  {
    id: 'credits',
    kind: 'card',
    card: 'credits',
    dur: 6,
    lines: [
      {
        a: 1.5,
        b: 6,
        text: 'Built by Harsh Bhanushali and Dhairya Patel. gavel.dualmindlab.tech. docs.gavel.dualmindlab.tech. github.com/harshbhx/gavel-auction. PayPal sandbox only.',
      },
    ],
  },
];
