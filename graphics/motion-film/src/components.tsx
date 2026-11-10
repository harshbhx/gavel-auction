// Brand-styled animated UI components: the big screen, the hold card and the ladder are built as
// motion components in the cream / ink / orange system, so no raw off-palette capture appears.
import type { CSSProperties } from 'react';
import { IO, cl, lerp, pr, usd } from './anim';
import { BODY, DISPLAY, INK, MONO, MUTE, ORANGE, PAPER } from './theme';

/** A number that rolls from `from` to `to` between a and a + d, tabular figures. */
export function rollCents(t: number, a: number, d: number, from: number, to: number) {
  return Math.round(lerp(from, to, pr(t, a, d, IO)));
}

const mono = (size: number, color: string): CSSProperties => ({
  fontFamily: MONO,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  fontSize: size,
  lineHeight: `${Math.round(size * 1.4)}px`,
  color,
});
const display = (size: number, color: string): CSSProperties => ({
  fontFamily: DISPLAY,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '.004em',
  fontSize: size,
  lineHeight: `${Math.round(size * 0.9)}px`,
  color,
  fontVariantNumeric: 'tabular-nums',
});

/** A stamp that lands: scales from 1.3 to 1 with a small rotation, ink or orange. */
export function Stamp({
  t,
  a,
  x,
  y,
  text,
  color = ORANGE,
  size = 40,
}: {
  t: number;
  a: number;
  x: number;
  y: number;
  text: string;
  color?: string;
  size?: number;
}) {
  const p = pr(t, a, 0.45, IO);
  if (p <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        padding: '6px 18px',
        border: `3px solid ${color}`,
        color,
        ...display(size, color),
        opacity: Math.min(1, p * 2),
        transform: `scale(${lerp(1.35, 1, p).toFixed(3)}) rotate(${lerp(-6, -3, p).toFixed(2)}deg)`,
        transformOrigin: '50% 50%',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  );
}

export type BigScreenState = {
  /** Scene seconds at which each accepted bid lands: [cents, time][] */
  bids: [number, number][];
  /** Scene second of the sold stamp, if any. */
  soldAt?: number;
  winner?: string;
  lot?: string;
  /** Scene second from which the component is on screen. */
  a: number;
};

/** The projection screen of the room, rebuilt in the brand: lot, the price that rolls up, the ladder, SOLD. */
export function BigScreen({
  t,
  x,
  y,
  w,
  h,
  state,
}: {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  state: BigScreenState;
}) {
  const inP = pr(t, state.a, 0.6);
  if (inP <= 0) return null;
  const landed = state.bids.filter(([, at]) => t >= at);
  const prev = landed.length >= 2 ? landed[landed.length - 2][0] : 0;
  const cur = landed.length ? landed[landed.length - 1] : null;
  const price = cur ? rollCents(t, cur[1], 0.6, prev, cur[0]) : 0;
  const sold = state.soldAt !== undefined && t >= state.soldAt;
  const pad = Math.round(w * 0.045);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: PAPER,
        border: `1.5px solid ${INK}`,
        overflow: 'hidden',
        opacity: inP,
        transform: `translateY(${((1 - inP) * 18).toFixed(1)}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: pad,
          top: pad - 4,
          ...mono(Math.round(w * 0.02), MUTE),
        }}
      >
        Big screen. {state.lot ?? 'Sandbox demo lot'}
      </div>
      <div
        style={{
          position: 'absolute',
          right: pad,
          top: pad - 4,
          ...mono(Math.round(w * 0.02), ORANGE),
        }}
      >
        {sold ? 'Closed' : cur ? 'Bidding open' : 'Lot open'}
      </div>
      <div
        style={{
          position: 'absolute',
          left: pad,
          right: pad,
          top: pad + Math.round(w * 0.05),
          height: 1.5,
          background: INK,
        }}
      />
      {/* the price */}
      <div
        style={{
          position: 'absolute',
          left: pad,
          top: pad + Math.round(w * 0.075),
          ...mono(Math.round(w * 0.018), MUTE),
        }}
      >
        {cur ? (sold ? 'Hammer price' : 'Current bid') : 'Opening bid'}
      </div>
      <div
        style={{
          position: 'absolute',
          left: pad - 4,
          top: pad + Math.round(w * 0.1),
          ...display(Math.round(w * 0.2), sold ? ORANGE : INK),
          transform: cur
            ? `scale(${(1 + 0.05 * Math.sin(Math.PI * cl((t - cur[1]) / 0.5))).toFixed(3)})`
            : undefined,
          transformOrigin: '0 50%',
        }}
      >
        {cur ? usd(price) : usd(1000)}
      </div>
      <div
        style={{
          position: 'absolute',
          left: pad,
          top: pad + Math.round(w * 0.3),
          ...mono(Math.round(w * 0.018), INK),
        }}
      >
        {cur ? `Paddle ${cur[0] === 1500 ? 2 : 1} leads` : 'Two holds in place'}
      </div>
      {/* the ladder */}
      <div
        style={{
          position: 'absolute',
          right: pad,
          top: pad + Math.round(w * 0.075),
          width: Math.round(w * 0.3),
        }}
      >
        <div style={{ ...mono(Math.round(w * 0.016), MUTE) }}>Latest</div>
        {state.bids.map(([c, at], i) => {
          const p = pr(t, at, 0.5);
          if (p <= 0) return null;
          const idx = landed.length - 1 - i;
          const lead = idx === 0;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                top: Math.round(w * 0.035) + idx * Math.round(w * 0.055) + (1 - p) * 20,
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                opacity: p * (lead ? 1 : 0.5),
                ...display(Math.round(w * 0.045), lead ? ORANGE : INK),
              }}
            >
              <span>{usd(c)}</span>
              <span style={{ ...mono(Math.round(w * 0.015), MUTE), paddingTop: 6 }}>
                P{c === 1500 ? 2 : 1}
              </span>
            </div>
          );
        })}
      </div>
      {sold ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: Math.round(h * 0.3) * pr(t, state.soldAt ?? 0, 0.5, IO),
              background: INK,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: pad,
              bottom: pad * 0.9,
              opacity: pr(t, (state.soldAt ?? 0) + 0.25, 0.4),
              ...display(Math.round(w * 0.075), PAPER),
            }}
          >
            Sold to <span style={{ color: ORANGE }}>{state.winner ?? 'paddle 1'}</span> for{' '}
            {usd(cur?.[0] ?? 2000)}
          </div>
          <Stamp
            t={t}
            a={(state.soldAt ?? 0) + 0.1}
            x={w - pad - Math.round(w * 0.2)}
            y={Math.round(h * 0.42)}
            text="Sold"
            size={Math.round(w * 0.07)}
          />
        </>
      ) : null}
    </div>
  );
}

export type HoldCardState = {
  a: number;
  name: string;
  /** Scene second the ceiling is chosen, and the ceiling in cents. */
  ceilingAt: number;
  ceiling: number;
  /** Press window of the approve button. */
  press: number;
  released: number;
  /** When the hold is confirmed held. */
  held: number;
};

/** The hold, as a card: name, the ceiling that rolls up, the 3 s press bar, the HELD stamp. */
export function HoldCard({
  t,
  x,
  y,
  w,
  state,
}: {
  t: number;
  x: number;
  y: number;
  w: number;
  state: HoldCardState;
}) {
  const inP = pr(t, state.a, 0.6);
  if (inP <= 0) return null;
  const chosen = t >= state.ceilingAt;
  const ceiling = rollCents(t, state.ceilingAt, 0.7, 1000, state.ceiling);
  const press = cl((t - state.press) / Math.max(0.2, state.released - state.press));
  const held = t >= state.held;
  const pad = Math.round(w * 0.06);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: Math.round(w * 0.86),
        background: PAPER,
        border: `1.5px solid ${INK}`,
        overflow: 'hidden',
        opacity: inP,
        transform: `translateY(${((1 - inP) * 18).toFixed(1)}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 8,
          height: '100%',
          background: ORANGE,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: pad,
          top: pad - 6,
          ...mono(Math.round(w * 0.026), MUTE),
        }}
      >
        {state.name}
      </div>
      <div
        style={{
          position: 'absolute',
          left: pad,
          top: pad + Math.round(w * 0.06),
          ...mono(Math.round(w * 0.024), INK),
        }}
      >
        {chosen ? 'Ceiling approved' : 'Pick a ceiling'}
      </div>
      <div
        style={{
          position: 'absolute',
          left: pad - 4,
          top: pad + Math.round(w * 0.1),
          ...display(Math.round(w * 0.3), INK),
        }}
      >
        {usd(ceiling, true)}
      </div>
      <div
        style={{
          position: 'absolute',
          left: pad,
          top: pad + Math.round(w * 0.41),
          width: w - 2 * pad,
          ...{
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: Math.round(w * 0.034),
            lineHeight: `${Math.round(w * 0.046)}px`,
            color: MUTE,
          },
        }}
      >
        {held
          ? 'An authorization, not a payment. Charged only if this paddle wins, and only the winning price.'
          : 'The most this bidder may bid. PayPal holds it; nothing is charged.'}
      </div>
      {/* the press bar */}
      <div
        style={{
          position: 'absolute',
          left: pad,
          right: pad,
          bottom: pad + Math.round(w * 0.05),
          height: 10,
          border: `1.5px solid ${INK}`,
          opacity: t >= state.press - 0.3 && !held ? 1 : 0.25,
        }}
      >
        <div
          style={{ height: '100%', width: `${(press * 100).toFixed(1)}%`, background: ORANGE }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: pad,
          bottom: pad - 4,
          ...mono(Math.round(w * 0.022), press > 0 && !held ? ORANGE : MUTE),
        }}
      >
        {held
          ? 'Hold in place'
          : press > 0
            ? `Hold the button. ${Math.max(0, 3 - press * 3).toFixed(1)} s`
            : 'Hold the button 3 seconds'}
      </div>
      {held ? (
        <Stamp
          t={t}
          a={state.held}
          x={Math.round(w * 0.5)}
          y={Math.round(w * 0.5)}
          text="Held, not charged"
          size={Math.round(w * 0.06)}
        />
      ) : null}
    </div>
  );
}

/** A mono eyebrow with a counter: "01 / 07" that rolls when the chapter changes. */
export function ChapterTick({
  t,
  a,
  n,
  x,
  y,
}: {
  t: number;
  a: number;
  n: number;
  x: number;
  y: number;
}) {
  const p = pr(t, a, 0.6);
  return (
    <div style={{ position: 'absolute', left: x, top: y, overflow: 'hidden', height: 30 }}>
      <div style={{ ...mono(20, ORANGE), transform: `translateY(${((1 - p) * 110).toFixed(1)}%)` }}>
        {String(n).padStart(2, '0')} / 07
      </div>
    </div>
  );
}
