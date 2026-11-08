import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { BidsGrid, BuiltWithAgGrid, HoldsGrid, LedgerGrid } from '../../grid';
import { holdRowsFromSim } from '../../grid/holdsModel';
import type { LedgerEntry } from '../../grid/ledgerModel';
import { holdsFromBodies, seeded, simulateBodies, simulateLedger } from '../../grid/simLedger';
import { sha256Hex } from '../../util/hash';
import { formatUsd } from '../../util/money';
import type { BidStreamRow } from '../console/BidStream';
import './ledger.css';

type Tab = 'ledger' | 'holds' | 'bids';
const TABS: readonly Tab[] = ['ledger', 'holds', 'bids'];
const TAB_KEY = {
  ledger: 'sim.tab.ledger',
  holds: 'sim.tab.holds',
  bids: 'sim.tab.bids',
} as const;

const SIM_DAYS = 30;
const BID_BASE = Date.UTC(2026, 8, 30, 20, 0, 0);

function seedBids(n: number): BidStreamRow[] {
  const rand = seeded(7);
  const rows: BidStreamRow[] = [];
  let price = 4000;
  for (let i = 1; i <= n; i += 1) {
    price += 500 * (1 + Math.floor(rand() * 3));
    rows.push({
      id: `sim-${i}`,
      serverTs: BID_BASE + i * 1500,
      seq: i,
      paddle: 1 + Math.floor(rand() * 7),
      amountCents: price,
      source: rand() < 0.5 ? 'voice' : rand() < 0.5 ? 'qr' : 'manual',
      confidence: null,
      status: 'accepted',
      reason: null,
    });
  }
  return rows;
}

/** A simulated bid feed: each second a bid arrives, and a voice bid that was pending is answered. */
function useBidFeed(running: boolean): BidStreamRow[] {
  const [rows, setRows] = useState<BidStreamRow[]>(() => seedBids(14));
  const rand = useRef(seeded(99));
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => {
      setRows((prev) => {
        const next = prev.map((r) => ({ ...r }));
        const pending = next.find((r) => r.status === 'pending');
        if (pending !== undefined) pending.status = rand.current() < 0.8 ? 'accepted' : 'rejected';
        const last = next[next.length - 1];
        const seq = (last?.seq ?? 0) + 1;
        const price = (last?.amountCents ?? 4000) + 500 * (1 + Math.floor(rand.current() * 3));
        const voice = rand.current() < 0.4;
        next.push({
          id: `sim-${seq}`,
          serverTs: (last?.serverTs ?? BID_BASE) + 1000,
          seq,
          paddle: 1 + Math.floor(rand.current() * 7),
          amountCents: price,
          source: voice ? 'voice' : 'manual',
          confidence: voice ? 0.72 + rand.current() * 0.25 : null,
          status: voice ? 'pending' : 'accepted',
          reason: null,
        });
        return next.slice(-500);
      });
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [running]);
  return rows;
}

/**
 * The ledger lab: the same three grids the console and audit page use, fed by a 30-day simulated
 * run. It is the performance showcase (thousands of sealed entries, virtualised) and a place to try
 * the chain check by simulating an edit. Everything here is simulated: no real money, no real people.
 */
export default function LedgerLab() {
  const [tab, setTab] = useState<Tab>('ledger');
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [edited, setEdited] = useState(false);
  const [running, setRunning] = useState(true);
  const baseId = useId();
  const bids = useBidFeed(running && tab === 'bids');

  useEffect(() => {
    let live = true;
    simulateLedger(sha256Hex, { days: SIM_DAYS }).then(
      (list) => {
        if (live) setEntries(list);
      },
      () => {
        if (live) setEntries([]);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const holds = useMemo(
    () => holdRowsFromSim(holdsFromBodies(simulateBodies({ days: SIM_DAYS }))),
    [],
  );
  const target = entries === null ? 0 : Math.floor(entries.length * 0.55);

  const shown = useMemo(() => {
    if (entries === null || !edited) return entries;
    // The edit changes an amount and leaves the stored hash alone, which is what tampering looks like.
    return entries.map((e) =>
      e.seq === target ? { ...e, amountCents: (e.amountCents ?? 0) + 500_000 } : e,
    );
  }, [entries, edited, target]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const at = TABS.indexOf(tab);
    const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (move === 0) return;
    e.preventDefault();
    const next = TABS[(at + move + TABS.length) % TABS.length];
    if (next !== undefined) {
      setTab(next);
      document.getElementById(`${baseId}-tab-${next}`)?.focus();
    }
  };

  const total = holds.reduce((n, h) => n + h.heldCents, 0);

  return (
    <div className="gv-lab">
      <p className="gv-lab__sub">{t('sim.sub')}</p>
      <dl className="gv-lab__stats">
        <div>
          <dt>{t('sim.stat.entries')}</dt>
          <dd className="gv-grid-num">
            {entries === null ? '...' : entries.length.toLocaleString('en-US')}
          </dd>
        </div>
        <div>
          <dt>{t('sim.stat.days')}</dt>
          <dd className="gv-grid-num">{SIM_DAYS}</dd>
        </div>
        <div>
          <dt>{t('sim.stat.holds')}</dt>
          <dd className="gv-grid-num">{`${holds.length} (${formatUsd(total)})`}</dd>
        </div>
      </dl>
      <div className="gv-lab__tabs" role="tablist" aria-label={t('sim.tabs')} onKeyDown={onKey}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`${baseId}-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => {
              setTab(k);
            }}
          >
            {t(TAB_KEY[k])}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="gv-lab__panel"
      >
        {tab === 'ledger' &&
          (shown === null ? (
            <p role="status">{t('sim.building')}</p>
          ) : (
            <LedgerGrid entries={shown} fileName="gavel-simulated-ledger" />
          ))}
        {tab === 'ledger' && shown !== null && (
          <div className="gv-lab__tamper">
            <Button
              variant="outline"
              tone="neutral"
              onClick={() => {
                setEdited((v) => !v);
              }}
            >
              {edited ? t('ledger.untamper') : t('ledger.tamper', { n: target })}
            </Button>
          </div>
        )}
        {tab === 'holds' && <HoldsGrid rows={holds} showDay fileName="gavel-simulated-holds" />}
        {tab === 'bids' && (
          <>
            <p className="gv-lab__note">{t('sim.bids.note')}</p>
            <div className="gv-lab__tamper">
              <Button
                variant="outline"
                tone="neutral"
                onClick={() => {
                  setRunning((v) => !v);
                }}
              >
                {running ? t('sim.bids.pause') : t('sim.bids.resume')}
              </Button>
            </div>
            <BidsGrid rows={bids} />
          </>
        )}
      </div>
      <footer className="gv-lab__foot">
        <BuiltWithAgGrid />
        <a href="/">{t('sim.back')}</a>
      </footer>
    </div>
  );
}
