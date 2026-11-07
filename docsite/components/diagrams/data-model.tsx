'use client';

import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { StepControls, useSteps } from './interactive';
import { Defs, T, hatch } from './kit';

// Data and ledger model. Verified against:
//   packages/server/src/boot/compose.ts            which store holds what (STORE=file or postgres)
//   packages/server/src/store/{file-room-store,file-ledger-store}.ts, migrations/0001_init.sql
//   packages/engine/src/{events,ledger/chain,ledger/public-export,projections}.ts
//   packages/shared/src/{ports,events}.ts           RoomStore, RoomEvent
//   packages/payments/src/{types,ports,saga/trail,stores/file}.ts   Journal, HoldRecord, audit rows
//   packages/server/src/{auth/authorize,http/export,admin/replay-bundle}.ts   who sees which field

type CardDef = { id: string; title: string; file: string; lines: string[] };

const CARDS: CardDef[] = [
  {
    id: 'room',
    title: 'ROOM LOG',
    file: 'rooms.jsonl (Postgres: events table)',
    lines: [
      'RoomEvent with seq 1, 2, 3 and no gap (assertGapless). 13 types: bid_accepted, hammered,',
      'settlement_update and more. The same file keeps snapshots and the token denylist.',
    ],
  },
  {
    id: 'ledger',
    title: 'ENGINE LEDGER',
    file: 'ledgers/<auctionId>.ledger.jsonl',
    lines: [
      'LedgerEntry: seq, at, type, cmd, payload, prev, hash. hash is SHA-256 of the canonical JSON',
      'without the hash field; the first prev is 64 zeros. One synced line per batch.',
    ],
  },
  {
    id: 'journal',
    title: 'PAYMENT JOURNAL',
    file: 'payments/journals.json (Postgres: journals table)',
    lines: [
      'Journal v1 per auction: state, plan, holds, cursor, intent, unknownSince, winner, failed,',
      'voids, history. Saved by compare-and-set on version; one writer holds a lease.',
    ],
  },
  {
    id: 'holds',
    title: 'HOLDS, WEBHOOK IDS, AUDIT, KILL SWITCH',
    file: 'holds.json, webhooks.json, payment-audit.jsonl, kill-switch.json',
    lines: [
      'HoldRecord status: PENDING_APPROVAL, HELD, CAPTURED, VOIDED, EXPIRED, DENIED, UNKNOWN.',
      'Audit rows: one per PayPal call and per state change, with the history seq of the journal.',
    ],
  },
];

const STEPS: { cards: string[]; text: string }[] = [
  {
    cards: ['room'],
    text: 'Step 1. A command becomes events. The room log holds the event first (appendEvents with the expected seq, so a gap or a repeat is a conflict).',
  },
  {
    cards: ['ledger'],
    text: 'Step 2. The service writes the engine ledger before it acknowledges that event. A crash leaves a whole batch or none: a torn last line is dropped on the next start.',
  },
  {
    cards: ['journal'],
    text: 'Step 3. After the hammer. The payment journal is saved only after LOT_HAMMERED is in the ledger, so a journal never names a winner the ledger does not know.',
  },
  {
    cards: ['journal', 'holds'],
    text: 'Step 4. Each saga transition is one compare-and-set save of the journal. Its state_change audit row is appended after the save; the row carries the history seq, so a row repeated after a crash is the same row.',
  },
  {
    cards: ['room'],
    text: 'Step 5. Settlement progress is reported to the room (Room.reportSettlement). Stale or repeated revisions are dropped; a new one is appended to the room log as a settlement_update and then broadcast.',
  },
];

type Cell = 'shown' | 'withheld' | 'absent';
const COLS = [
  { a: 'Operator', b: 'admin key' },
  { a: 'Auctioneer', b: 'export' },
  { a: 'Public', b: 'replay bundle' },
  { a: 'Auditor', b: 'projection' },
];
const ROWS: { label: string; cells: Cell[] }[] = [
  { label: 'Bidder ceiling', cells: ['shown', 'withheld', 'withheld', 'shown'] },
  { label: 'Over-ceiling rejection amount', cells: ['shown', 'withheld', 'withheld', 'shown'] },
  { label: 'Hold reference', cells: ['shown', 'withheld', 'withheld', 'shown'] },
  { label: 'Bidder display name', cells: ['shown', 'withheld', 'absent', 'absent'] },
  { label: 'Voice transcript', cells: ['shown', 'withheld', 'withheld', 'shown'] },
];

export function DataModelDiagram() {
  const steps = useSteps(STEPS.length);
  const activeCards = STEPS[steps.index]?.cards ?? [];

  return (
    <DiagramFrame
      title="Data and ledger model: what is written, in what order, and who sees what"
      desc="Left: four stores. The room log, the engine ledger with its hash chain, the payment journal, and holds, webhook ids, audit rows and the kill switch. A step control shows the write order: room log first, then ledger, then journal after the hammer. Right: a table of five private fields against four views. The operator sees all of them, the auctioneer export and the public replay bundle see none of the private ones, and the auditor projection shows them except for sealed lots before the hammer."
      width={1200}
      height={640}
      badge={<Chip kind="fake">Fake PayPal for tests</Chip>}
      toolbar={<StepControls steps={steps} title="Write order" labels={STEPS.map((s) => s.text)} />}
      caption={
        <>
          Verified against <code>packages/server/src/boot/compose.ts</code> (stores), <code>packages/engine/src/ledger/chain.ts</code>,{' '}
          <code>ledger/public-export.ts</code>, <code>projections.ts</code>, <code>packages/payments/src/types.ts</code> and{' '}
          <code>saga/trail.ts</code>, and the redaction in <code>packages/server/src/auth/authorize.ts</code> and <code>http/export.ts</code>. The
          auditor projection is a library function today; no server route calls it. Write order comes from the note in{' '}
          <code>store/file-ledger-store.ts</code> (decisions D-0012 and D-0014).
        </>
      }
      transcript={
        <>
          <p>Four stores and four views.</p>
          <ul>
            <li>Room log: RoomEvent records with gapless seq, plus snapshots and the token denylist. Written first.</li>
            <li>Engine ledger: hash-chained entries, one file per auction. Written before the event is acknowledged.</li>
            <li>Payment journal: one per auction, saved by compare-and-set, only after the hammer is in the ledger.</li>
            <li>Holds, webhook ids, audit rows and the kill switch file.</li>
            <li>Operator (admin key) sees ceilings, over-ceiling rejection amounts, hold references, names and transcripts.</li>
            <li>The auctioneer export drops the ceiling, the over-ceiling amount, names, hold references and transcripts.</li>
            <li>The public replay bundle (export version 4) drops ceilings, hold references, rejection amounts, leader fields and transcripts; names never enter the ledger.</li>
            <li>The auditor projection shows the whole ledger, except that bid amounts and recording details of a sealed lot are withheld until it is hammered.</li>
          </ul>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={640} style={{ fill: 'var(--hl-bg)' }} />

          <T x={16} y={30} cls="t-small t-ink">STORES (STORE=file; the file names are under /var/data)</T>
          {CARDS.map((c, i) => {
            const y = 44 + i * 112;
            const on = activeCards.includes(c.id);
            return (
              <g key={c.id}>
                <rect
                  x={16}
                  y={y}
                  width={560}
                  height={100}
                  rx={2}
                  className="node"
                  style={on ? { stroke: 'var(--hl-signal-ink)', strokeWidth: 3 } : undefined}
                />
                <rect x={16} y={y} width={8} height={100} fill={hatch(p)} className="fill-hatch-edge" opacity={on ? 1 : 0.5} />
                <T x={36} y={y + 22} cls="t-big">{c.title}</T>
                <T x={36} y={y + 40} cls="t-small t-ink">{c.file}</T>
                {c.lines.map((l, j) => (
                  <T key={l} x={36} y={y + 60 + j * 16} cls="t-small">
                    {l}
                  </T>
                ))}
              </g>
            );
          })}
          <T x={16} y={510} cls="t-small t-muted">With STORE=postgres the room log, snapshots, denylist and journals move to Postgres;</T>
          <T x={16} y={526} cls="t-small t-muted">ledgers, holds, webhook ids and the kill switch stay in the data directory, which one host locks.</T>

          {/* visibility matrix */}
          <T x={604} y={30} cls="t-small t-ink">WHO SEES WHICH PRIVATE FIELD</T>
          {COLS.map((c, i) => (
            <g key={c.a}>
              <T x={808 + i * 88 + 44} y={62} anchor="middle" cls="t-small" >
                {c.a}
              </T>
              <T x={808 + i * 88 + 44} y={76} anchor="middle" cls="t-small t-muted">
                {c.b}
              </T>
            </g>
          ))}
          <line x1={604} y1={90} x2={1170} y2={90} className="guide" />
          {ROWS.map((r, ri) => {
            const y = 100 + ri * 48;
            return (
              <g key={r.label}>
                <T x={604} y={y + 24} cls="t-small">{r.label}</T>
                {r.cells.map((cell, ci) => {
                  const x = 808 + ci * 88 + 8;
                  return (
                    <g key={ci}>
                      {cell === 'shown' && <rect x={x} y={y + 4} width={72} height={30} className="fill-solid" />}
                      {cell === 'withheld' && <rect x={x} y={y + 4} width={72} height={30} fill={hatch(p)} className="fill-hatch-edge" />}
                      {cell === 'absent' && <rect x={x} y={y + 4} width={72} height={30} className="fill-hollow" />}
                      <rect
                        x={x + 6}
                        y={y + 12}
                        width={60}
                        height={14}
                        style={{ fill: cell === 'shown' ? 'var(--hl-go)' : 'var(--hl-panel)' }}
                        opacity={cell === 'withheld' ? 1 : 0}
                      />
                      <text
                        x={x + 36}
                        y={y + 23}
                        textAnchor="middle"
                        className="t-small"
                        style={{ fontWeight: 700, fill: cell === 'shown' ? 'var(--hl-bg)' : 'var(--hl-fg)' }}
                      >
                        {cell === 'shown' ? 'shown' : cell === 'withheld' ? 'withheld' : 'not there'}
                      </text>
                    </g>
                  );
                })}
                <line x1={604} y1={y + 44} x2={1170} y2={y + 44} className="guide" />
              </g>
            );
          })}
          <T x={604} y={358} cls="t-small t-muted">Solid: shown. Hatched: withheld. Hollow: not in that record at all (names never enter the ledger).</T>

          <rect x={604} y={380} width={566} height={146} className="panel" />
          <T x={616} y={400} cls="t-small t-ink">SEALED LOTS (mode second_price)</T>
          <T x={616} y={420} cls="t-small">projectPublic: price and leader are null until the hammer.</T>
          <T x={616} y={436} cls="t-small">projectAuditor: bid amount, transcript, parsedCents, utteranceId and audio</T>
          <T x={616} y={452} cls="t-small">offsets are withheld until the lot is hammered or unsold. An option</T>
          <T x={616} y={468} cls="t-small">full: true shows them to an authorised caller.</T>
          <T x={616} y={490} cls="t-small t-muted">Public export: sealed amounts are dropped until the hammer; proxy</T>
          <T x={616} y={506} cls="t-small t-muted">lots drop each bid amount (the secret maximum) for good.</T>

          <T x={16} y={570} cls="t-small t-muted">The live socket frames are filtered separately for each role (authorize.ts redaction); this diagram covers the stored records and their exports.</T>
        </>
      )}
    />
  );
}
