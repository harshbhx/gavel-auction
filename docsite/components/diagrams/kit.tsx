import type { ReactNode } from 'react';

// Small helpers shared by the five diagrams. Everything is plain SVG; colours come from the
// Holdline CSS variables (see app/global.css, section "diagrams"), so the three themes work
// without a second copy of each figure.

/** Hatch pattern and arrow markers; ids are prefixed so two copies on one page do not clash. */
export function Defs({ p }: { p: string }) {
  return (
    <defs>
      <pattern
        id={`${p}-hatch`}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="6" height="6" style={{ fill: 'var(--hl-panel)' }} />
        <rect width="2" height="6" style={{ fill: 'var(--hl-signal-ink)' }} />
      </pattern>
      <marker id={`${p}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--hl-fg-muted)' }} />
      </marker>
      <marker id={`${p}-arrow-dark`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--hl-fg)' }} />
      </marker>
      <marker id={`${p}-arrow-stop`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--hl-stop)' }} />
      </marker>
    </defs>
  );
}

export const hatch = (p: string) => `url(#${p}-hatch)`;

type NodeProps = {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  sub?: string;
  kind?: 'node' | 'term' | 'stop';
  /** Brass rule on top: the node is a state where money moves. */
  money?: boolean;
  /** Small stop-coloured notch marker: this state can move to review. */
  review?: boolean;
};

export function Node({ x, y, w, h = 52, label, sub, kind = 'node', money, review }: NodeProps) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2} className={kind === 'term' ? 'node-term' : kind === 'stop' ? 'node-stop' : 'node'} />
      {money && <rect x={x} y={y} width={w} height={5} className="rule-money" />}
      <text x={x + w / 2} y={y + (sub ? h / 2 - 2 : h / 2 + 4.5)} textAnchor="middle" className="t-big" style={{ fontSize: 12.5 }}>
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" className="t-muted t-small">
          {sub}
        </text>
      )}
      {review && (
        <g>
          <polygon points={`${x + w - 14},${y + h} ${x + w},${y + h} ${x + w},${y + h - 14}`} className="fill-stop" />
        </g>
      )}
    </g>
  );
}

type TextProps = { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; cls?: string };
export function T({ x, y, children, anchor = 'start', cls }: TextProps) {
  return (
    <text x={x} y={y} textAnchor={anchor} className={cls}>
      {children}
    </text>
  );
}

/** Numbered callout badge: a small square with the number, used with a text label next to it. */
export function Badge({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <rect x={x} y={y} width={20} height={20} rx={2} style={{ fill: 'var(--hl-signal)' }} />
      <text x={x + 10} y={y + 14.5} textAnchor="middle" style={{ fill: 'var(--hl-on-signal)', fontWeight: 800, fontSize: 12.5 }}>
        {n}
      </text>
    </g>
  );
}

/** Legend: the three fills and the review notch. */
export function Legend({ p, x, y }: { p: string; x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={26} height={14} fill={hatch(p)} className="fill-hatch-edge" />
      <T x={x + 34} y={y + 11} cls="t-small">held</T>
      <rect x={x + 86} y={y} width={26} height={14} className="fill-solid" />
      <T x={x + 120} y={y + 11} cls="t-small">charged</T>
      <rect x={x + 190} y={y} width={26} height={14} className="fill-hollow" />
      <T x={x + 224} y={y + 11} cls="t-small">released</T>
      <polygon points={`${x + 296},${y + 14} ${x + 310},${y + 14} ${x + 310},${y}`} className="fill-stop" />
      <T x={x + 318} y={y + 11} cls="t-small">needs review</T>
    </g>
  );
}
