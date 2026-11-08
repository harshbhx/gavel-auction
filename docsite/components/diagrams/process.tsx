import { useId } from 'react';
import { Defs, Badge, hatch } from './kit';

// The process of one auction, in seven stages, from the hold to the check. Static inline SVG:
// no script, no motion. Every stage links to the page that explains it. Two layouts share the
// same data: a row on wide screens and a column on phones (CSS shows one of them).
//
// What each stage says is read from the docs it links to: registration-and-holds (the hold for the
// ceiling), bid-lifecycle and auction-states (bids, the soft close extension and its cap, the
// hammer), settlement-saga (capture of the winning price, void of the others), start/demo (the
// receipt) and engine-and-ledger (the audit trail and the hash chain verifier).
type Stage = {
  n: number;
  label: string;
  lines: string[];
  href: string;
  /** held: hatched strip; settle: solid + hollow strip; none: no strip. */
  state: 'held' | 'settle' | 'none';
};

export const processStages: Stage[] = [
  { n: 1, label: 'Join', lines: ['Choose a ceiling.', 'PayPal sandbox', 'puts a hold for it'], href: '/docs/how-it-works/registration-and-holds', state: 'held' },
  { n: 2, label: 'Bid', lines: ['Bid up to the', 'ceiling. Engine', 'checks, ledger', 'records it'], href: '/docs/how-it-works/bid-lifecycle', state: 'held' },
  { n: 3, label: 'Soft close', lines: ['A late bid', 'extends the lot', '(extensions', 'are capped)'], href: '/docs/how-it-works/auction-states', state: 'held' },
  { n: 4, label: 'Hammer', lines: ['The lot closes.', 'Winner and price', 'are fixed'], href: '/docs/how-it-works/auction-states', state: 'held' },
  { n: 5, label: 'Settle', lines: ['Capture the', 'winning price.', 'Void every', 'other hold'], href: '/docs/how-it-works/settlement-saga', state: 'settle' },
  { n: 6, label: 'Receipt', lines: ['The outcome as', 'a settlement', 'document'], href: '/docs/start/demo', state: 'none' },
  { n: 7, label: 'Verify', lines: ['Replay the audit', 'trail and check', 'the hash chain'], href: '/docs/how-it-works/engine-and-ledger', state: 'none' },
];

const summary = processStages.map((s) => `${s.n}. ${s.label}: ${s.lines.join(' ')}`).join(' ');

function Strip({ p, s, x, y, w }: { p: string; s: Stage['state']; x: number; y: number; w: number }) {
  if (s === 'held') return <rect x={x} y={y} width={w} height={10} fill={hatch(p)} className="fill-hatch-edge" />;
  if (s === 'settle')
    return (
      <g>
        <rect x={x} y={y} width={w / 2} height={10} className="fill-solid" />
        <rect x={x + w / 2} y={y} width={w / 2} height={10} className="fill-hollow" />
      </g>
    );
  return null;
}

function Stages({ p, layout }: { p: string; layout: 'row' | 'col' }) {
  const row = layout === 'row';
  const W = row ? 1000 : 360;
  const nodeW = row ? 122 : 330;
  const nodeH = row ? 136 : 92;
  const stepX = 142;
  const stepY = 118;
  const H = row ? 240 : 24 + stepY * 6 + nodeH + 60;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-labelledby={`${p}-title`}
      className="dg block h-auto w-full"
    >
      <title id={`${p}-title`}>{`The process of one GAVEL auction in seven stages. ${summary}`}</title>
      <Defs p={p} />
      {processStages.map((s, i) => {
        const x = row ? 10 + i * stepX : 15;
        const y = row ? 50 : 14 + i * stepY;
        const last = i === processStages.length - 1;
        return (
          <g key={s.n}>
            {!last &&
              (row ? (
                <path d={`M${x + nodeW + 2} ${y + 72} H${x + stepX - 2}`} className="edge" markerEnd={`url(#${p}-arrow)`} />
              ) : (
                <path d={`M${x + nodeW / 2} ${y + nodeH + 2} V${y + stepY - 2}`} className="edge" markerEnd={`url(#${p}-arrow)`} />
              ))}
            <a href={s.href} className="proc-link" aria-label={`Step ${s.n}, ${s.label}: ${s.lines.join(' ')}. Open the page.`}>
              <rect x={x} y={y} width={nodeW} height={nodeH} rx={2} className="node" />
              <Strip p={p} s={s.state} x={x} y={y} w={nodeW} />
              {row ? (
                <>
                  <Badge x={x + 8} y={y - 36} n={s.n} />
                  <text x={x + nodeW / 2} y={y + 36} textAnchor="middle" className="t-big">
                    {s.label}
                  </text>
                  {s.lines.map((l, k) => (
                    <text key={k} x={x + nodeW / 2} y={y + 58 + k * 15} textAnchor="middle" className="t-muted">
                      {l}
                    </text>
                  ))}
                </>
              ) : (
                <>
                  <Badge x={x + 14} y={y + 24} n={s.n} />
                  <text x={x + 48} y={y + 39} className="t-big">
                    {s.label}
                  </text>
                  <text x={x + 48} y={y + 58} className="t-muted">
                    {s.lines.slice(0, 2).join(' ')}
                  </text>
                  <text x={x + 48} y={y + 74} className="t-muted">
                    {s.lines.slice(2).join(' ')}
                  </text>
                </>
              )}
            </a>
          </g>
        );
      })}
      {/* legend */}
      {(() => {
        const ly = H - 26;
        const lx = row ? 10 : 15;
        return (
          <g>
            <rect x={lx} y={ly} width={26} height={14} fill={hatch(p)} className="fill-hatch-edge" />
            <text x={lx + 34} y={ly + 11} className="t-small">
              held, nothing charged
            </text>
            <rect x={lx + (row ? 190 : 150)} y={ly} width={26} height={14} className="fill-solid" />
            <text x={lx + (row ? 224 : 184)} y={ly + 11} className="t-small">
              charged
            </text>
            <rect x={lx + (row ? 290 : 232)} y={ly} width={26} height={14} className="fill-hollow" />
            <text x={lx + (row ? 324 : 266)} y={ly + 11} className="t-small">
              released
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

export function ProcessDiagram() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <figure className="hl-process not-prose my-8">
      <div className="hidden md:block">
        <Stages p={`${uid}r`} layout="row" />
      </div>
      <div className="mx-auto max-w-[24rem] md:hidden">
        <Stages p={`${uid}c`} layout="col" />
      </div>
      <figcaption className="mt-3 text-[0.85rem] text-fd-muted-foreground">
        The process of one auction. Each stage links to its page. Only the winning price is charged at
        stage 5; every other hold is released. The PayPal side runs on the sandbox only.
      </figcaption>
    </figure>
  );
}
