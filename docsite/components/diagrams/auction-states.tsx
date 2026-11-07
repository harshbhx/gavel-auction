'use client';

import { useState, type ReactNode } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { DetailPanel, useHot } from './interactive';
import { Defs, T } from './kit';

// B2. The lot state machine and the soft close clock.
// Verified against: packages/engine/src/types.ts (LotStatus), packages/engine/src/evolve.ts (which
// event sets which status), packages/engine/src/decide/{open-lot,hammer,abort-lot,pause}.ts,
// packages/engine/src/rules/softclose.ts (extension, hardCloseOf), packages/engine/src/config.ts
// (limits), packages/server/src/runtime/ledger-engine.ts (hard close margin, status mapping) and
// packages/server/src/boot/compose.ts (demoAuctionConfig, the numbers of the clock below).
const W = 1000;
const H = 640;

// Demo lot: packages/server/src/boot/compose.ts demoAuctionConfig.
const DEMO = { durationS: 600, windowS: 30, extensionS: 30, maxExtensions: 5 };
// ledger-engine.ts: hardCloseMs = durationMs + min(maxExtensions * extensionMs, 3_600_000).
const HARD_S = DEMO.durationS + Math.min(DEMO.maxExtensions * DEMO.extensionS, 3600);

// Same rule as extension() in packages/engine/src/rules/softclose.ts, in whole seconds.
function extend(endsAt: number, at: number, used: number): number {
  if (used >= DEMO.maxExtensions) return endsAt;
  if (at < endsAt - DEMO.windowS) return endsAt;
  const next = Math.max(endsAt, at + DEMO.extensionS);
  return Math.min(next, Math.max(endsAt, HARD_S));
}

const details: Record<string, ReactNode> = {
  PENDING: (
    <>
      <strong>PENDING.</strong> The lot is configured and waits its turn: lots open one at a time, in lot order.{' '}
      <code>OpenLot</code> sets <code>endsAt</code> to the command time plus the lot duration. File:{' '}
      <code>packages/engine/src/decide/open-lot.ts</code>.
    </>
  ),
  OPEN: (
    <>
      <strong>OPEN.</strong> Bids are accepted while the bid time is before <code>endsAt</code>. An accepted bid inside
      the soft-close window can move <code>endsAt</code> (<code>END_EXTENDED</code>). A pause freezes the clock with a
      flag, not a new state: bids are refused as <code>lot_not_open</code> until resume. Files:{' '}
      <code>engine/src/rules/validate-bid.ts</code>, <code>rules/softclose.ts</code>, <code>decide/pause.ts</code>.
    </>
  ),
  CLOSING: (
    <>
      <strong>CLOSING.</strong> <code>LOT_CLOSING</code> is written when a tick finds the deadline passed, or by an early
      hammer. No bid is accepted from here. The hammer needs CLOSING, or OPEN with <code>early</code>. In the room an
      optional <code>autoHammerDelayMs</code> hammers by itself after that delay; the demo config sets none, so the
      auctioneer hammers. Files: <code>engine/src/decide/hammer.ts</code>, <code>server/src/room/room.ts</code>.
    </>
  ),
  SETTLING: (
    <>
      <strong>SETTLING.</strong> <code>LOT_HAMMERED</code> fixes the winner, the price, the ranking and the fallback
      candidates. The lot is frozen: no pause, no abort, no bids. The payments saga takes over here, see{' '}
      <a href="/docs/how-it-works/settlement-saga">Settlement saga</a>. File: <code>engine/src/evolve.ts</code>.
    </>
  ),
  DONE: (
    <>
      <strong>DONE.</strong> Reached by <code>LOT_SETTLED</code> (captured and released), <code>LOT_UNSOLD</code> (no bids,
      or no candidate left after a fallback) or <code>LOT_ABORTED</code> (the kill switch before the hammer). A DONE lot
      accepts nothing. File: <code>engine/src/evolve.ts</code>.
    </>
  ),
};

type Hist = { at: number; from: number; to: number };
type Sim = { end: number; hist: Hist[] };
const START: Sim = { end: DEMO.durationS, hist: [] };
const BEFORE = [1, 10, 29, 30, 31];

const sx = (s: number) => 60 + s * (880 / 780);

export function AuctionStatesDiagram() {
  const hot = useHot();
  const [sim, setSim] = useState<Sim>(START);
  const [before, setBefore] = useState(10);
  const [note, setNote] = useState<string>('Pick how many seconds before the end a bid arrives, then place it.');

  const place = () => {
    const at = sim.end - before;
    const used = sim.hist.length;
    const next = extend(sim.end, at, used);
    if (used >= DEMO.maxExtensions) {
      setNote(`At ${at} s: no extension. The limit of ${DEMO.maxExtensions} extensions is used up, the end stays at ${sim.end} s.`);
      return;
    }
    if (at < sim.end - DEMO.windowS) {
      setNote(`At ${at} s: outside the ${DEMO.windowS} s window, the end stays at ${sim.end} s.`);
      return;
    }
    if (next === sim.end) {
      setNote(`At ${at} s: inside the window, but a bid ${DEMO.windowS} s before the end only resets the clock to where it already is. The end stays at ${sim.end} s.`);
      return;
    }
    setSim({ end: next, hist: [...sim.hist, { at, from: sim.end, to: next }] });
    setNote(`At ${at} s: the end moves ${sim.end} s to ${next} s (extension ${used + 1} of ${DEMO.maxExtensions}). New end = bid time plus ${DEMO.extensionS} s.`);
  };
  const reset = () => {
    setSim(START);
    setNote('Reset. The lot ends at 600 s.');
  };

  const btn = 'inline-flex items-center rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent';

  return (
    <DiagramFrame
      title="Lot states, hammer and soft close"
      desc="Top: the lot state machine. PENDING moves to OPEN on LOT_OPENED, OPEN to CLOSING on LOT_CLOSING, CLOSING to SETTLING on LOT_HAMMERED, and SETTLING to DONE on LOT_SETTLED or LOT_UNSOLD. A hammer with no bids goes from CLOSING straight to DONE. LOT_ABORTED from PENDING, OPEN or CLOSING ends in DONE. Bottom: a time axis for the demo lot, a ten minute lot with a 30 second soft-close window, a 30 second extension, at most five extensions and a hard close at 750 seconds, with the end marker moved by each simulated bid."
      width={W}
      height={H}
      minWidth={900}
      badge={<Chip kind="hollow">Read from code</Chip>}
      toolbar={
        <div className="space-y-3">
          <DetailPanel active={hot.active} details={details} hint="Hover, focus or tap a state for what it means and where it lives." />
          <div className="border-t border-[var(--hl-hairline)] pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="font-mono text-[0.7rem] uppercase" htmlFor="sc-before">
                A bid arrives
              </label>
              <select
                id="sc-before"
                value={before}
                onChange={(e) => setBefore(Number(e.target.value))}
                className="rounded-[2px] border bg-fd-card px-2 py-1 font-mono text-[0.75rem]"
              >
                {BEFORE.map((b) => (
                  <option key={b} value={b}>
                    {b} s before the end
                  </option>
                ))}
              </select>
              <button type="button" className={btn} onClick={place}>
                Place the bid
              </button>
              <button type="button" className={btn} onClick={reset} disabled={sim.hist.length === 0}>
                Reset
              </button>
            </div>
            <p className="mt-2 min-h-[2.5rem]" aria-live="polite">
              {note}
            </p>
          </div>
        </div>
      }
      caption={
        <>
          Source: <code>packages/engine/src/evolve.ts</code> (which entry sets which status),{' '}
          <code>engine/src/rules/softclose.ts</code> (the extension rule, copied into the simulator above),{' '}
          <code>engine/src/decide/hammer.ts</code> and <code>packages/server/src/runtime/ledger-engine.ts</code> (hard close
          margin). The clock numbers are the demo lot in <code>packages/server/src/boot/compose.ts</code>; the engine
          default is soft close off. This is a map of rules, not a measurement.
        </>
      }
      transcript={
        <>
          <p>Lot states and the entry that moves between them:</p>
          <ul>
            <li>PENDING to OPEN: LOT_OPENED.</li>
            <li>OPEN to CLOSING: LOT_CLOSING, written at the deadline by a tick, or by an early hammer.</li>
            <li>CLOSING to SETTLING: LOT_HAMMERED.</li>
            <li>SETTLING to DONE: LOT_SETTLED, or LOT_UNSOLD when no candidate is left.</li>
            <li>CLOSING to DONE: a hammer with no bids writes LOT_UNSOLD.</li>
            <li>PENDING, OPEN or CLOSING to DONE: LOT_ABORTED, the kill switch before the hammer. A SETTLING lot cannot be aborted.</li>
          </ul>
          <p>
            Soft close for the demo lot: the lot lasts 600 seconds, the window is 30 seconds, an extension sets the end to the
            bid time plus 30 seconds (never earlier than the old end), at most 5 extensions happen, and the hard close is at
            750 seconds. A bid 30 seconds before the end changes nothing, a bid 1 second before the end moves it by 29 seconds.
          </p>
        </>
      }
      render={(p) => {
        const node = (id: keyof typeof details, x: number, w: number, kind: 'node' | 'term' = 'node') => (
          <g {...hot.props(id)}>
            <rect x={x} y={130} width={w} height={52} rx={2} className={kind === 'term' ? 'node-term' : 'node'} style={hot.active === id ? { strokeWidth: 3 } : undefined} />
            <T x={x + w / 2} y={161} anchor="middle" cls="t-big">{id}</T>
          </g>
        );
        const ticks = [0, 100, 200, 300, 400, 500, 600, 700];
        return (
          <>
            <Defs p={p} />
            <rect x={0} y={0} width={W} height={H} style={{ fill: 'var(--hl-bg)' }} />

            {/* abort path along the top */}
            <path d="M85 130 V50 H905 V128" className="edge-stop" markerEnd={`url(#${p}-arrow-stop)`} />
            <path d="M285 130 V50 M490 130 V50" className="edge-stop" />
            <T x={495} y={40} anchor="middle" cls="t-small t-stop">LOT_ABORTED: kill switch, from PENDING, OPEN or CLOSING</T>

            {node('PENDING', 30, 110)}
            {node('OPEN', 230, 110)}
            {node('CLOSING', 430, 120)}
            {node('SETTLING', 640, 120)}
            {node('DONE', 850, 110, 'term')}

            <path d="M140 156 H228" className="edge" markerEnd={`url(#${p}-arrow)`} />
            <T x={184} y={148} anchor="middle" cls="t-small t-muted">LOT_OPENED</T>
            <path d="M340 156 H428" className="edge" markerEnd={`url(#${p}-arrow)`} />
            <T x={384} y={148} anchor="middle" cls="t-small t-muted">LOT_CLOSING</T>
            <path d="M550 156 H638" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
            <T x={594} y={148} anchor="middle" cls="t-small t-muted">LOT_HAMMERED</T>
            <path d="M760 156 H848" className="edge" markerEnd={`url(#${p}-arrow)`} />
            <T x={804} y={148} anchor="middle" cls="t-small t-muted">LOT_SETTLED</T>
            <T x={804} y={176} anchor="middle" cls="t-small t-muted">or LOT_UNSOLD</T>

            {/* self loop on OPEN */}
            <path d="M250 182 C250 216 320 216 320 182" className="edge" fill="none" markerEnd={`url(#${p}-arrow)`} />
            <T x={285} y={232} anchor="middle" cls="t-small t-muted">BID_RECORDED, END_EXTENDED</T>

            {/* no bids */}
            <path d="M490 182 V262 H905 V184" className="edge" markerEnd={`url(#${p}-arrow)`} />
            <T x={700} y={254} anchor="middle" cls="t-small t-muted">hammer with no bids: LOT_UNSOLD</T>

            <T x={700} y={212} anchor="middle" cls="t-small t-ink">money: settlement saga</T>

            <T x={30} y={296} cls="t-small">Wire status in a room snapshot: OPEN, CLOSING, SETTLING or DONE, plus a paused flag. The enum also lists SCHEDULED and PAUSED;</T>
            <T x={30} y={312} cls="t-small">the server never sends them as a status, the web client derives PAUSED from paused: true.</T>
            <path d="M30 330 H970" className="guide" />

            {/* soft close clock */}
            <T x={30} y={356} cls="t-big">Soft close clock, demo lot (seconds after the lot opens)</T>
            <T x={30} y={374} cls="t-small t-muted">window 30 s, extension 30 s, at most 5 extensions, hard close 750 s</T>

            {/* window band */}
            <rect x={sx(sim.end - DEMO.windowS)} y={470} width={sx(sim.end) - sx(sim.end - DEMO.windowS)} height={30} className="panel-2" style={{ stroke: 'var(--hl-border)', strokeDasharray: '3 3' }} />
            <T x={sx(sim.end - DEMO.windowS) + 2} y={464} cls="t-small t-muted">window</T>

            <path d="M60 500 H940" className="edge" />
            {ticks.map((t) => (
              <g key={t}>
                <path d={`M${sx(t)} 500 v6`} className="edge" />
                <T x={sx(t)} y={520} anchor="middle" cls="t-small t-muted">{t}</T>
              </g>
            ))}

            {/* planned end and hard close */}
            <path d={`M${sx(DEMO.durationS)} 480 V500`} className="edge" style={{ strokeWidth: 2 }} />
            <T x={sx(DEMO.durationS)} y={548} anchor="middle" cls="t-small t-muted">planned end 600</T>
            <path d={`M${sx(HARD_S)} 410 V506`} className="edge-stop" />
            <T x={sx(HARD_S)} y={566} anchor="middle" cls="t-small t-stop">hard close {HARD_S}</T>

            {/* extensions so far */}
            {sim.hist.map((h, i) => (
              <g key={`${h.at}-${i}`}>
                <path d={`M${sx(h.from)} 446 H${sx(h.to) - 2}`} className="edge-dash" markerEnd={`url(#${p}-arrow)`} />
                <T x={(sx(h.from) + sx(h.to)) / 2} y={440} anchor="middle" cls="t-small t-muted">{i + 1}</T>
              </g>
            ))}

            {/* current end */}
            <path d={`M${sx(sim.end)} 420 V500`} className="edge-thick" />
            <rect x={sx(sim.end) - 4} y={494} width={8} height={12} className="fill-solid" />
            <T x={sx(sim.end)} y={410} anchor="middle" cls="t-small">ends at {sim.end}</T>

            <T x={30} y={606} cls="t-small t-muted">Numbers: packages/server/src/boot/compose.ts demoAuctionConfig; hard close = duration + min(5 x 30 s, 1 h).</T>
            <T x={30} y={622} cls="t-small t-muted">With these numbers the limit of five extensions stops the clock before the hard close.</T>
          </>
        );
      }}
    />
  );
}
