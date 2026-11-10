import type { CSSProperties, ReactNode } from 'react';
import { cl, EXIT, hash, lerp, pr, sp } from './anim';
import {
  BODY,
  colors,
  DISPLAY,
  INK,
  INK_DEEP,
  MONO,
  MUTE,
  ORANGE,
  ORANGE_DEEP,
  PAPER,
  PAPER_HI,
  RULE_PAPER,
  type World,
} from './theme';

/* The product, rebuilt as components in the app's own language (tokens.css: 2 px ink borders,
   2 px shadows, radius 3 to 6, Public Sans body, Big Shoulders display, JetBrains Mono labels; the hold
   is hatched while held, solid at the hammer, hollow when released). Every piece is a function of time. */

export const card = (world: World, extra: CSSProperties = {}): CSSProperties => {
  const c = colors(world);
  return {
    background: c.card,
    border: `2px solid ${world === 'paper' ? INK : '#4a3b31'}`,
    borderRadius: 6,
    boxShadow: world === 'paper' ? `3px 3px 0 ${INK}` : `0 30px 80px rgba(0,0,0,0.45)`,
    color: c.fg,
    fontFamily: BODY,
    ...extra,
  };
};

/** A phone shell with a 390x844 screen. */
export function Phone({
  children,
  scale = 0.78,
  style,
  world = 'paper',
}: {
  children: ReactNode;
  scale?: number;
  style?: CSSProperties;
  world?: World;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        width: 418,
        height: 872,
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 60,
          background: `linear-gradient(160deg, #2a211b, ${INK_DEEP})`,
          boxShadow: '0 40px 120px rgba(0,0,0,0.5), inset 0 0 0 2px #3b2f27',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 14,
          top: 14,
          width: 390,
          height: 844,
          borderRadius: 48,
          overflow: 'hidden',
          background: world === 'paper' ? PAPER : INK,
          color: world === 'paper' ? INK : PAPER,
          fontFamily: BODY,
        }}
      >
        {children}
        <div
          style={{
            position: 'absolute',
            left: 130,
            top: 12,
            width: 130,
            height: 34,
            borderRadius: 17,
            background: INK_DEEP,
          }}
        />
      </div>
    </div>
  );
}

/** The app's thin top bar inside a phone: sandbox banner and lot title. */
export function PhoneTop({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ padding: '62px 22px 0' }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: ORANGE_DEEP,
        }}
      >
        Sandbox: no real money moves
      </div>
      <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 800, marginTop: 10 }}>{title}</div>
      {sub ? <div style={{ fontSize: 14, color: MUTE, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

/** Hatch pattern definition (one per SVG). */
export const Hatch = ({ id, color = ORANGE_DEEP }: { id: string; color?: string }) => (
  <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="10" height="10" fill={PAPER_HI} />
    <rect width="4" height="10" fill={color} />
  </pattern>
);

/**
 * The hold bar: `held` (0..1) draws the hatched part, `cap` (0..1 of the width) fills solid from the left,
 * `release` (0..1) turns the rest hollow (dashed) and lifts it by `lift` px.
 */
export function HoldBar({
  w,
  h,
  held,
  cap = 0,
  capFrac = 0,
  release = 0,
  id,
  lift = 0,
  stroke = INK,
}: {
  w: number;
  h: number;
  held: number;
  cap?: number;
  capFrac?: number;
  release?: number;
  id: string;
  lift?: number;
  stroke?: string;
}) {
  const cw = w * capFrac * cap;
  return (
    <svg width={w} height={h + lift + 4} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <Hatch id={id} />
      </defs>
      <g transform={`translate(0 ${lift + 2})`}>
        <rect
          x={1}
          y={1}
          width={Math.max(0, w * held - 2)}
          height={h - 2}
          fill={`url(#${id})`}
          stroke={stroke}
          strokeWidth={2}
          opacity={1 - release}
        />
        {cap > 0 ? (
          <rect x={1} y={1} width={Math.max(0, cw - 2)} height={h - 2} fill={ORANGE} stroke={stroke} strokeWidth={2} />
        ) : null}
        {release > 0 ? (
          <rect
            x={cw + 1}
            y={1 - release * lift}
            width={Math.max(0, w - cw - 2)}
            height={h - 2}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeDasharray="8 6"
            opacity={release}
          />
        ) : null}
      </g>
    </svg>
  );
}

/** A status chip (mono, uppercase). */
export function Chip({
  text,
  tone = 'ink',
  style,
  size = 13,
}: {
  text: string;
  tone?: 'ink' | 'orange' | 'hollow' | 'paper';
  style?: CSSProperties;
  size?: number;
}) {
  const s: CSSProperties =
    tone === 'orange'
      ? { background: ORANGE, color: '#1a0a00', border: `2px solid ${ORANGE}` }
      : tone === 'hollow'
        ? { background: 'transparent', color: MUTE, border: `2px dashed ${MUTE}` }
        : tone === 'paper'
          ? { background: PAPER_HI, color: INK, border: `2px solid ${INK}` }
          : { background: INK, color: PAPER_HI, border: `2px solid ${INK}` };
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: MONO,
        fontSize: size,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '5px 10px',
        borderRadius: 3,
        lineHeight: 1,
        ...s,
        ...style,
      }}
    >
      {text}
    </span>
  );
}

/** A hold-to-confirm button with a ring that fills over `holdDur` s from `pressAt`. */
export function RingButton({
  t,
  pressAt,
  holdDur = 3,
  size = 180,
  label,
  world = 'paper',
  done,
}: {
  t: number;
  pressAt: number;
  holdDur?: number;
  size?: number;
  label: ReactNode;
  world?: World;
  done?: ReactNode;
}) {
  const p = cl((t - pressAt) / holdDur);
  const down = t >= pressAt && p < 1 ? 1 : 0;
  const r = size / 2 - 8;
  const C = 2 * Math.PI * r;
  const finished = p >= 1;
  const k = finished ? 1 + 0.06 * Math.sin(Math.PI * cl((t - pressAt - holdDur) / 0.4)) : 1 - down * 0.04;
  const fg = world === 'paper' ? INK : PAPER;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        transform: `scale(${k.toFixed(3)})`,
      }}
    >
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={fg} strokeOpacity={0.18} strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ORANGE}
          strokeWidth={6}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p)}
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 16,
          borderRadius: '50%',
          background: finished ? ORANGE : fg,
          color: finished ? '#1a0a00' : world === 'paper' ? PAPER_HI : INK,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: size * 0.16,
          lineHeight: 1,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          boxShadow: down ? 'inset 0 6px 18px rgba(0,0,0,0.35)' : '0 10px 30px rgba(0,0,0,0.25)',
        }}
      >
        {finished && done ? done : label}
      </div>
      {down ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            fontFamily: MONO,
            fontSize: size * 0.09,
            color: ORANGE,
            marginTop: size * 0.3,
          }}
        >
          {(holdDur - p * holdDur).toFixed(1)} s
        </div>
      ) : null}
    </div>
  );
}

/** A stamp that lands with a spring (scale 1.6 -> 1, rotate -8 -> -4). */
export function Stamp({
  t,
  at,
  fps,
  text,
  color = ORANGE,
  size = 64,
  style,
  ink = '#1a0a00',
}: {
  t: number;
  at: number;
  fps: number;
  text: string;
  color?: string;
  size?: number;
  style?: CSSProperties;
  ink?: string;
}) {
  if (t < at) return null;
  const s = sp(t, at, fps, { damping: 12, stiffness: 220 });
  return (
    <div
      style={{
        position: 'absolute',
        fontFamily: DISPLAY,
        fontWeight: 900,
        fontSize: size,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: ink,
        background: color,
        padding: `${size * 0.1}px ${size * 0.3}px`,
        borderRadius: 4,
        lineHeight: 1,
        transform: `scale(${lerp(1.7, 1, s).toFixed(3)}) rotate(${lerp(-10, -4, s).toFixed(2)}deg)`,
        opacity: cl(s * 3),
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/** A deterministic QR-like module grid (not a real code) that builds in a radial stagger from `at`. */
export function QR({
  t,
  at,
  size = 200,
  n = 25,
  dark = INK,
  light = PAPER_HI,
  seed = 7,
}: {
  t: number;
  at: number;
  size?: number;
  n?: number;
  dark?: string;
  light?: string;
  seed?: number;
}) {
  const m = size / n;
  const finder = (i: number, j: number) =>
    (i < 7 && j < 7) || (i < 7 && j >= n - 7) || (i >= n - 7 && j < 7);
  const finderOn = (i: number, j: number) => {
    const ii = i < 7 ? i : i - (n - 7);
    const jj = j < 7 ? j : j - (n - 7);
    const ring = ii === 0 || ii === 6 || jj === 0 || jj === 6;
    const core = ii >= 2 && ii <= 4 && jj >= 2 && jj <= 4;
    return ring || core;
  };
  const cells: ReactNode[] = [];
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n; j += 1) {
      const on = finder(i, j) ? finderOn(i, j) : hash(seed, i, j) < 0.47;
      if (!on) continue;
      const d = Math.hypot(i - n / 2, j - n / 2) / (n * 0.72);
      const p = pr(t, at + d * 0.6, 0.25);
      if (p <= 0) continue;
      cells.push(
        <rect
          key={`${i}-${j}`}
          x={j * m + (m * (1 - p)) / 2}
          y={i * m + (m * (1 - p)) / 2}
          width={m * p}
          height={m * p}
          fill={dark}
        />,
      );
    }
  return (
    <svg width={size} height={size} style={{ display: 'block', background: light, borderRadius: 4 }}>
      {cells}
    </svg>
  );
}

/** A waveform of `bars` bars; `level(t)` 0..1 drives the amplitude. */
export function Waveform({
  t,
  level,
  bars = 64,
  w = 900,
  h = 160,
  color = ORANGE,
}: {
  t: number;
  level: number;
  bars?: number;
  w?: number;
  h?: number;
  color?: string;
}) {
  const bw = w / bars;
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {Array.from({ length: bars }, (_, i) => {
        const env = Math.sin((i / bars) * Math.PI);
        const n = 0.5 + 0.5 * Math.sin(t * 13 + i * 0.9) * Math.sin(t * 7.3 + i * 0.37);
        const a = Math.max(0.03, level * env * (0.35 + 0.65 * n));
        const bh = Math.max(4, a * h);
        return (
          <rect
            key={i}
            x={i * bw + bw * 0.25}
            y={(h - bh) / 2}
            width={bw * 0.5}
            height={bh}
            rx={bw * 0.25}
            fill={color}
            opacity={0.55 + 0.45 * a}
          />
        );
      })}
    </svg>
  );
}

/** A small key / value row for receipts and ledgers. */
export function Row({
  k,
  v,
  world = 'paper',
  size = 15,
  strong,
  style,
}: {
  k: string;
  v: ReactNode;
  world?: World;
  size?: number;
  strong?: boolean;
  style?: CSSProperties;
}) {
  const c = colors(world);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        padding: '8px 0',
        borderBottom: `1px solid ${world === 'paper' ? RULE_PAPER : '#3a2f27'}`,
        fontFamily: BODY,
        fontSize: size,
        color: c.fg,
        ...style,
      }}
    >
      <span style={{ color: c.mute, fontFamily: MONO, fontSize: size - 2, letterSpacing: '0.06em' }}>{k}</span>
      <span style={{ fontWeight: strong ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}

/** A plane that tilts in from `from` and levels to 0 by `at + dur` (3D card entrance). */
export const tiltIn = (t: number, at: number, dur: number, from: { rx?: number; ry?: number; z?: number }) => {
  const p = pr(t, at, dur);
  const e = 1 - pr(t, at, dur, EXIT);
  return `translateZ(${((from.z ?? -200) * (1 - p)).toFixed(1)}px) rotateX(${((from.rx ?? 0) * (1 - p)).toFixed(2)}deg) rotateY(${((from.ry ?? 0) * (1 - p)).toFixed(2)}deg)` + (e ? '' : '');
};
