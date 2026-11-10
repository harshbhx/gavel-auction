// Where each screen of the tour sits in the judge journey (order = the NN in the file name), which
// folder it is filed under, and the route it lives at. Views not listed here land in `misc`.
// sandbox: the screen shows a simulated sandbox room, hold or receipt (never real money).

export const CATALOG = {
  landing: { order: 1, area: 'landing', screen: 'Landing', route: '/' },
  home: { order: 2, area: 'home', screen: 'Home (returning visitor)', route: '/' },
  try: { order: 3, area: 'judge', screen: 'Judge panel', route: '/try', sandbox: true },
  demo: { order: 4, area: 'demo', screen: 'Demo launcher', route: '/demo', sandbox: true },
  scripted: {
    order: 5,
    area: 'demo',
    screen: 'Scripted demo',
    route: '/demo/scripted',
    sandbox: true,
  },
  'scripted-player': {
    order: 5,
    area: 'demo',
    screen: 'Scripted demo player',
    route: '/demo/scripted',
    sandbox: true,
  },
  join: { order: 6, area: 'join', screen: 'Join', route: '/join/:code', sandbox: true },
  register: {
    order: 7,
    area: 'register',
    screen: 'Register',
    route: '/r/:room/register',
    sandbox: true,
  },
  return: {
    order: 8,
    area: 'register',
    screen: 'Return from approval',
    route: '/r/:room/return',
    sandbox: true,
  },
  bid: { order: 9, area: 'bidder', screen: 'Bidder screen', route: '/r/:room/bid', sandbox: true },
  hub: { order: 10, area: 'hub', screen: 'Room hub', route: '/r/:room/hub', sandbox: true },
  console: {
    order: 11,
    area: 'console',
    screen: 'Auctioneer console',
    route: '/r/:room/console',
    sandbox: true,
  },
  screen: {
    order: 12,
    area: 'screen',
    screen: 'Projection screen',
    route: '/r/:room/screen',
    sandbox: true,
  },
  receipt: {
    order: 13,
    area: 'receipt',
    screen: 'Receipt',
    route: '/r/:room/receipt',
    sandbox: true,
  },
  'receipt-share': {
    order: 14,
    area: 'receipt',
    screen: 'Shared receipt',
    route: '/r/:room/receipt#share',
    sandbox: true,
  },
  audit: { order: 15, area: 'audit', screen: 'Audit', route: '/r/:room/audit', sandbox: true },
  grid: {
    order: 16,
    area: 'audit',
    screen: 'Ledger grid and ledger lab',
    route: '/ledger and /r/:room/audit',
    sandbox: true,
  },
  verify: { order: 17, area: 'audit', screen: 'Verify', route: '/verify' },
  replay: {
    order: 18,
    area: 'replay',
    screen: 'Replay',
    route: '/replay/:recording',
    sandbox: true,
  },
  ops: { order: 19, area: 'ops', screen: 'Operator page', route: '/ops' },
  help: { order: 20, area: 'help', screen: 'Help and tour', route: 'overlay on any screen' },
  error: { order: 21, area: 'errors', screen: 'Error boundary', route: '(any route)' },
  boot: { order: 22, area: 'errors', screen: 'Boot configuration error', route: '(any route)' },
  'not-found': { order: 23, area: 'errors', screen: 'Not found', route: '/<unknown>' },
  'token-missing': {
    order: 24,
    area: 'errors',
    screen: 'Operator link missing its key',
    route: '/r/:room/console',
  },
  alerts: {
    order: 25,
    area: 'misc',
    screen: 'Sound alerts toggle',
    route: 'overlay on any screen',
  },
  gallery: { order: 26, area: 'misc', screen: 'Component gallery (dev route)', route: '/gallery' },
  docs: { order: 30, area: 'docs', screen: 'Docs site', route: 'docs site (static export)' },
};

/** Plain-language notes for states whose names are terse. Unlisted states use their name. */
export const STATE_NOTES = {
  'landing/default': 'first visit',
  'landing/code-typed': 'room code typed',
  'landing/code-not-found': 'room code not found',
  'try/rooms-on': 'judge panel, rooms open',
  'try/rooms-off': 'judge panel, rooms off',
  'bid/live-winning': 'lot open, you lead',
  'bid/live-outbid': 'lot open, you are outbid',
  'bid/live-near-ceiling': 'lot open, price near your limit',
  'bid/confirm-sheet': 'confirm sheet, "Did you mean"',
  'screen/sold': 'projection screen, sold',
  'screen/lobby-no-bids': 'projection screen, starting soon (lobby)',
  'receipt/winner-charged': 'receipt, winner',
  'receipt/not-winner-released': 'receipt, other bidder, hold released',
  'grid/ledger-lab-verified': 'ledger lab, chain verified',
  'grid/ledger-lab-edited': 'ledger lab, edited entry detected',
};

/** The eight best states, cropped 3:2 for Devpost. */
export const DEVPOST = [
  {
    name: 'landing',
    view: 'landing',
    state: 'default',
    caption: 'Landing: start a sandbox room or join with a code',
  },
  {
    name: 'judge-panel',
    view: 'try',
    state: 'rooms-on',
    caption: 'Judge panel: one click to a demo room',
  },
  {
    name: 'room-hub',
    view: 'hub',
    state: 'ready',
    caption: 'Room hub: invite bidders by code or QR',
  },
  {
    name: 'bidder-leading',
    view: 'bid',
    state: 'live-winning',
    caption: 'Bidder screen: you are leading',
  },
  {
    name: 'bidder-outbid',
    view: 'bid',
    state: 'live-outbid',
    caption: 'Bidder screen: outbid, raise within your limit',
  },
  {
    name: 'console-live',
    view: 'console',
    state: 'live-bidding',
    caption: 'Auctioneer console: bids stream in, hammer ready',
  },
  { name: 'projection-sold', view: 'screen', state: 'sold', caption: 'Projection screen: sold' },
  {
    name: 'ledger-verified',
    view: 'grid',
    state: 'ledger-lab-verified',
    caption: 'Ledger lab: hash chain verified',
  },
];

/** Captures dropped by hand after reviewing the contact sheets: [view/state or view/prefix-, reason]. */
export const DROP = [
  [
    'landing/code-typed',
    'a keyboard-focused skip link and the sticky header show mid-page in the full-page capture',
  ],
  [
    'landing/code-not-found',
    'a keyboard-focused skip link and the sticky header show mid-page in the full-page capture',
  ],
  ['hub/fit-', 'layout fit checks at other window sizes; the same state is hub/ready'],
];
