import type { CSSProperties, ReactNode } from 'react';
import { Img, staticFile } from 'remotion';
import { cl, EXIT, pr, useT } from './anim';
import type { Cap, Chapter } from './types';
import { BODY, DISPLAY, MONO, ORANGE, W, worldColors } from './theme';

/** Renders `**word**` as the orange word. */
export function Em({ text }: { text: string }) {
  const parts = text.split('**');
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} style={{ color: ORANGE }}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const fam = (f: 'd' | 'm' | 'b'): CSSProperties =>
  f === 'd'
    ? { fontFamily: DISPLAY, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.004em' }
    : f === 'm'
      ? { fontFamily: MONO, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em' }
      : { fontFamily: BODY, fontWeight: 600, letterSpacing: '-.005em' };

type RiseProps = {
  t: number;
  /** Start second of the rise, duration, and an optional exit second. */
  a: number;
  d?: number;
  out?: number;
  x: number;
  y: number;
  w?: number;
  size: number;
  f?: 'd' | 'm' | 'b';
  color?: string;
  align?: 'left' | 'right' | 'center';
  lh?: number;
  upper?: boolean;
  children: ReactNode;
};

/** A clipped line of type that rises into place (the kinetic-type mask reveal), and sinks on exit. */
export function Rise({
  t,
  a,
  d = 0.75,
  out,
  x,
  y,
  w = 1100,
  size,
  f = 'd',
  color,
  align = 'left',
  lh,
  upper,
  children,
}: RiseProps) {
  const k = lh ?? (f === 'd' ? 0.86 : 1.45);
  const h = Math.round(size * k);
  const en = pr(t, a, d);
  const ex = out === undefined ? 0 : pr(t, out, 0.3, EXIT);
  const ty = (1 - en) * 110 - ex * 110;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          ...fam(f),
          ...(upper === false ? { textTransform: 'none' } : {}),
          fontSize: size,
          lineHeight: `${h}px`,
          color,
          textAlign: align,
          ...(f === 'd' ? { letterSpacing: `${(0.004 + (1 - en) * 0.05).toFixed(4)}em` } : {}),
          transform: `translateY(${ty.toFixed(2)}%)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** A hairline that draws itself from the left (or top with axis y). */
export function Rule({
  t,
  a,
  d = 0.8,
  out,
  x,
  y,
  w = 1,
  h = 1.5,
  color,
  axis = 'x',
}: {
  t: number;
  a: number;
  d?: number;
  out?: number;
  x: number;
  y: number;
  w?: number;
  h?: number;
  color: string;
  axis?: 'x' | 'y';
}) {
  const en = pr(t, a, d, (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2));
  const ex = out === undefined ? 0 : pr(t, out, 0.3, EXIT);
  const v = ex > 0 ? 1 - ex : en;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: color,
        transformOrigin:
          axis === 'y' ? (ex > 0 ? '50% 100%' : '50% 0') : ex > 0 ? '100% 50%' : '0 50%',
        transform: axis === 'y' ? `scaleY(${v.toFixed(4)})` : `scaleX(${v.toFixed(4)})`,
      }}
    />
  );
}

/** Static mono text (eyebrows, labels, sources). */
export function Mono({
  x,
  y,
  w = 900,
  size = 17,
  color,
  align = 'left',
  upper = true,
  opacity = 1,
  children,
  style,
}: {
  x: number;
  y: number;
  w?: number;
  size?: number;
  color: string;
  align?: 'left' | 'right' | 'center';
  upper?: boolean;
  opacity?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        ...fam('m'),
        ...(upper ? {} : { textTransform: 'none' }),
        fontSize: size,
        lineHeight: `${Math.round(size * 1.4)}px`,
        color,
        textAlign: align,
        opacity,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Body text block (the explanation beside a display word). */
export function Body({
  t,
  a,
  x,
  y,
  w,
  size = 29,
  color,
  children,
}: {
  t: number;
  a: number;
  x: number;
  y: number;
  w: number;
  size?: number;
  color: string;
  children: ReactNode;
}) {
  const p = pr(t, a, 0.6);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y + (1 - p) * 14,
        width: w,
        ...fam('b'),
        fontSize: size,
        lineHeight: `${Math.round(size * 1.3)}px`,
        color,
        opacity: p,
      }}
    >
      {children}
    </div>
  );
}

export const CHAPTERS = ['Open', 'Join', 'Hold', 'Bid', 'Hammer', 'Receipt', 'Verify'];
export const SOURCE = 'Recorded run. Simulated holds. No PayPal call.';
export const FOOT = 'PayPal sandbox only. No real money moves.';
export const URL_TXT = 'gavel.dualmindlab.tech';

/** Masthead, hairlines, footer and (on paper scenes) the chapter rail. */
export function Chrome({
  world,
  chapter,
  source,
  t,
  a = 0,
}: {
  world: 'ink' | 'paper';
  chapter?: Chapter;
  source?: string;
  t: number;
  a?: number;
}) {
  const c = worldColors(world);
  const wm = staticFile(world === 'ink' ? 'brand/wordmark-white.svg' : 'brand/wordmark-color.svg');
  const fade = pr(t, a, 0.5);
  return (
    <>
      <Img
        src={wm}
        style={{ position: 'absolute', left: 64, top: 30, height: 44, opacity: fade }}
      />
      {source ? (
        <Mono x={1056} y={44} w={800} size={18} color={c.mute} align="right" opacity={fade}>
          {source}
        </Mono>
      ) : null}
      <Rule t={t} a={a} d={0.7} x={64} y={104} w={1792} color={c.line} />
      <Rule t={t} a={a + 0.1} d={0.7} x={64} y={1000} w={1792} color={c.line} />
      <Mono x={64} y={1020} size={17} color={c.mute} opacity={pr(t, a + 0.3, 0.5)}>
        {FOOT}
      </Mono>
      <Mono
        x={1056}
        y={1020}
        w={800}
        size={17}
        color={c.mute}
        align="right"
        upper={false}
        opacity={pr(t, a + 0.3, 0.5)}
      >
        {URL_TXT}
      </Mono>
      {chapter ? (
        <>
          <Rule t={t} a={a} d={0.7} x={64} y={916} w={1792} color={c.line} />
          {CHAPTERS.map((name, i) => {
            const on = i + 1 === chapter.n;
            const x = 64 + i * 256;
            return (
              <div key={name}>
                {on ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: x,
                      top: 930,
                      width: 96 * pr(t, a + 0.2, 0.6),
                      height: 5,
                      background: ORANGE,
                    }}
                  />
                ) : null}
                <Mono
                  x={x}
                  y={944}
                  w={240}
                  size={21}
                  color={on ? c.fg : c.mute}
                  opacity={pr(t, a + 0.1 + i * 0.04, 0.4)}
                  style={{ fontWeight: on ? 800 : 600 }}
                >
                  <span style={{ color: on ? ORANGE : c.mute }}>{i + 1}</span>&nbsp; {name}
                </Mono>
              </div>
            );
          })}
        </>
      ) : null}
    </>
  );
}

/** The caption column of a recorded scene: display line plus an optional body sub line. */
export function Caps({
  caps,
  world,
  x = 1392,
  y = 150,
  w = 464,
  size = 74,
}: {
  caps: Cap[];
  world: 'ink' | 'paper';
  x?: number;
  y?: number;
  w?: number;
  size?: number;
}) {
  const t = useT();
  const c = worldColors(world);
  return (
    <>
      {caps.map((cap, i) => {
        const inP = cl((t - cap.a) / 0.55);
        const outP = cl((t - (cap.b - 0.3)) / 0.3);
        if (inP <= 0 || outP >= 1) return null;
        const ip = 1 - Math.pow(1 - inP, 4);
        const op = outP * outP * outP;
        const lines = cap.text.split(' / ');
        const lh = Math.round(size * 0.92);
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, width: w }}>
            {lines.map((ln, k) => {
              const p = cl(ip * 1.25 - k * 0.12);
              return (
                <div key={k} style={{ overflow: 'hidden', height: lh }}>
                  <div
                    style={{
                      ...fam('d'),
                      fontSize: size,
                      lineHeight: `${lh}px`,
                      color: c.fg,
                      transform: `translateY(${((1 - p) * 110 - op * 110).toFixed(2)}%)`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Em text={ln} />
                  </div>
                </div>
              );
            })}
            {cap.sub ? (
              <div style={{ overflow: 'hidden', marginTop: 22, paddingBottom: 6 }}>
                <div
                  style={{
                    ...fam('b'),
                    fontSize: 27,
                    lineHeight: '36px',
                    color: c.mute,
                    transform: `translateY(${((1 - cl(ip * 1.25 - 0.25)) * 110 - op * 110).toFixed(2)}%)`,
                  }}
                >
                  {cap.sub}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** A full-frame colour plate that wipes in from the left along the beat (the ink to paper change). */
export function Wipe({
  t,
  a,
  d = 0.7,
  color,
}: {
  t: number;
  a: number;
  d?: number;
  color: string;
}) {
  const p = pr(t, a, d, (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2));
  if (p <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: W * p,
        height: '100%',
        background: color,
      }}
    />
  );
}

/** A slow push on a block of content (about 3 % over the scene), the ambient motion of a card. */
export function Push({
  t,
  dur,
  amount = 0.03,
  origin = '50% 45%',
  children,
}: {
  t: number;
  dur: number;
  amount?: number;
  origin?: string;
  children: ReactNode;
}) {
  const s = 1 + amount * cl(t / dur);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: W,
        height: '100%',
        transformOrigin: origin,
        transform: `scale(${s.toFixed(4)})`,
      }}
    >
      {children}
    </div>
  );
}
