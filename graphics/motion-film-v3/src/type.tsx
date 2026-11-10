import type { CSSProperties, ReactNode } from 'react';
import { cl, EXIT, lerp, pr } from './anim';
import { colors, DISPLAY, MONO, ORANGE, type World } from './theme';
import type { Cap } from './types';

/* Kinetic type: line masks that rise, tracking that tightens as a line lands, an orange word, and
   odometer numbers whose digits roll on their own. */

/** `**word**` becomes the orange word. */
export function rich(text: string, accent = ORANGE): ReactNode {
  const parts = text.split('**');
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <span key={i} style={{ color: accent }}>
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function Rise({
  t,
  at,
  dur = 0.8,
  out,
  outDur = 0.3,
  children,
  size = 120,
  color,
  font = DISPLAY,
  weight = 700,
  track = true,
  style,
  lineHeight = 0.98,
  align,
}: {
  t: number;
  at: number;
  dur?: number;
  out?: number;
  outDur?: number;
  children: ReactNode;
  size?: number;
  color?: string;
  font?: string;
  weight?: number;
  track?: boolean;
  style?: CSSProperties;
  lineHeight?: number;
  align?: 'left' | 'center' | 'right';
}) {
  const p = pr(t, at, dur);
  const e = out === undefined ? 0 : pr(t, out, outDur, EXIT);
  if (t < at || e >= 1) return null;
  return (
    <div
      style={{
        overflow: 'hidden',
        lineHeight,
        paddingBottom: '0.12em',
        marginBottom: '-0.12em',
        textAlign: align,
        ...style,
      }}
    >
      <div
        style={{
          transform: `translateY(${((1 - p) * 112 - e * 40).toFixed(2)}%)`,
          opacity: 1 - e,
          letterSpacing: track ? `${lerp(0.06, -0.005, p).toFixed(4)}em` : undefined,
          fontFamily: font,
          fontSize: size,
          fontWeight: weight,
          color,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Several lines, each in its own mask, staggered. `**word**` is orange, ` / ` breaks lines. */
export function Display({
  t,
  at,
  out,
  text,
  size = 120,
  color,
  stagger = 0.085,
  dur = 0.8,
  style,
  align,
  weight = 700,
}: {
  t: number;
  at: number;
  out?: number;
  text: string;
  size?: number;
  color?: string;
  stagger?: number;
  dur?: number;
  style?: CSSProperties;
  align?: 'left' | 'center' | 'right';
  weight?: number;
}) {
  const lines = text.split(' / ');
  return (
    <div style={style}>
      {lines.map((l, i) => (
        <Rise
          key={i}
          t={t}
          at={at + i * stagger}
          dur={dur}
          out={out === undefined ? undefined : out + i * 0.04}
          size={size}
          color={color}
          align={align}
          weight={weight}
        >
          {rich(l)}
        </Rise>
      ))}
    </div>
  );
}

/** Mono label that types itself in. */
export function Mono({
  t,
  at,
  text,
  size = 20,
  color,
  dur = 0.7,
  style,
  out,
}: {
  t: number;
  at: number;
  text: string;
  size?: number;
  color?: string;
  dur?: number;
  style?: CSSProperties;
  out?: number;
}) {
  const p = pr(t, at, dur, (x) => x);
  const e = out === undefined ? 0 : pr(t, out, 0.3, EXIT);
  if (t < at || e >= 1) return null;
  const n = Math.round(p * text.length);
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: size,
        letterSpacing: '0.04em',
        color,
        opacity: 1 - e,
        whiteSpace: 'pre',
        ...style,
      }}
    >
      {text.slice(0, n)}
      {p < 1 ? <span style={{ color: ORANGE }}>_</span> : null}
    </div>
  );
}

/** The caption column of a product scene: display lines at the left (or bottom), from the scene table. */
export function Caps({
  t,
  caps,
  world,
  x = 96,
  y = 300,
  size = 124,
  width = 720,
  align,
}: {
  t: number;
  caps: Cap[];
  world: World;
  x?: number;
  y?: number;
  size?: number;
  width?: number;
  align?: 'left' | 'center' | 'right';
}) {
  const c = colors(world);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width }}>
      {caps.map((cap, i) => {
        if (t < cap.a || t > cap.b + 0.35) return null;
        return (
          <div key={i} style={{ position: 'absolute', left: 0, top: 0, width }}>
            <Display
              t={t}
              at={cap.a + (i > 0 ? 0.3 : 0)}
              out={cap.b}
              text={cap.text}
              size={size}
              color={c.fg}
              align={align}
            />
          </div>
        );
      })}
    </div>
  );
}

export type Step = { at: number; v: number };

/** Odometer: each digit rolls on its own column. `fmt` turns a value into the string shown. */
export function Roll({
  t,
  steps,
  fmt,
  size = 200,
  color,
  font = DISPLAY,
  weight = 800,
  dur = 0.5,
  style,
  first = 0.9,
}: {
  t: number;
  steps: Step[];
  fmt: (v: number) => string;
  size?: number;
  color?: string;
  font?: string;
  weight?: number;
  dur?: number;
  style?: CSSProperties;
  /** Duration of the first roll (from the value before the first step, or from zero). */
  first?: number;
}) {
  let i = -1;
  for (let k = 0; k < steps.length; k += 1) if (steps[k].at <= t) i = k;
  const cur = i >= 0 ? steps[i] : { at: -1, v: steps[0]?.v ?? 0 };
  const prev = i > 0 ? steps[i - 1] : { at: -1, v: 0 };
  const p = i >= 0 ? pr(t, cur.at, i === 0 ? first : dur) : 1;
  const s1 = fmt(cur.v);
  const s0 = i >= 0 ? fmt(prev.v) : s1;
  const len = Math.max(s0.length, s1.length);
  const a = s0.padStart(len, ' ');
  const b = s1.padStart(len, ' ');
  const lh = 1;
  const up = cur.v >= prev.v;
  return (
    <div
      style={{
        display: 'inline-flex',
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        color,
        lineHeight: lh,
        height: `${lh}em`,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {Array.from({ length: len }, (_, k) => {
        const c0 = a[k];
        const c1 = b[k];
        const d0 = /\d/.test(c0) ? Number(c0) : null;
        const d1 = /\d/.test(c1) ? Number(c1) : null;
        if (d1 !== null) {
          const from = d0 ?? (up ? (d1 + 7) % 10 : (d1 + 3) % 10);
          const diff = up ? (d1 - from + 10) % 10 : -((from - d1 + 10) % 10);
          const stag = cl(1 - (len - 1 - k) * 0.08);
          const pp = cl((p - (1 - stag) * 0.3) / Math.max(0.3, stag));
          const pos = from + diff * (i >= 0 ? pr(0.5 + pp / 2, 0.5, 0.5) : 1);
          return (
            <span
              key={k}
              style={{
                display: 'inline-block',
                overflow: 'hidden',
                height: `${lh}em`,
                verticalAlign: 'top',
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  display: 'block',
                  transform: `translateY(${(-(pos + 10) * lh).toFixed(3)}em)`,
                }}
              >
                {Array.from({ length: 30 }, (_, j) => (
                  <span key={j} style={{ display: 'block', height: `${lh}em` }}>
                    {(j + 10) % 10}
                  </span>
                ))}
              </span>
            </span>
          );
        }
        const fade = c0 === c1 ? 1 : p;
        return (
          <span
            key={k}
            style={{
              display: 'inline-block',
              opacity: c1 === ' ' ? 0 : fade,
              width: c1 === ' ' ? 0 : undefined,
            }}
          >
            {c1 === ' ' ? '' : c1}
          </span>
        );
      })}
    </div>
  );
}

/** A hairline that draws itself from `at`. */
export function Rule({
  t,
  at,
  dur = 0.7,
  x,
  y,
  w,
  color,
  thick = 1.5,
  vertical = false,
  out,
}: {
  t: number;
  at: number;
  dur?: number;
  x: number;
  y: number;
  w: number;
  color: string;
  thick?: number;
  vertical?: boolean;
  out?: number;
}) {
  const p = pr(t, at, dur);
  const e = out === undefined ? 0 : pr(t, out, 0.3, EXIT);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: vertical ? thick : w * p,
        height: vertical ? w * p : thick,
        background: color,
        opacity: 1 - e,
      }}
    />
  );
}
