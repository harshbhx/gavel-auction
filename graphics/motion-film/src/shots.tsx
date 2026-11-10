// The paper world: the recorded app on a plane under a camera, captions beside it, graphics tied to
// the recorded events (press rings, hold tiles, the bid ladder).
import { AbsoluteFill } from 'remotion';
import { IO, pr, useT } from './anim';
import { Camera, Pane, Ring } from './pane';
import { DISPLAY, INK, MUTE, ORANGE, PAPER } from './theme';
import type { Box, SceneProps } from './types';
import type { ReactNode } from 'react';
import { Caps, Chrome, Mono, Rule, SOURCE } from './ui';

type P = { sc: SceneProps; letters: string[] };

/** The stage of a recorded scene: chrome, camera with the panes, captions. */
function Stage({
  sc,
  children,
  overlay,
}: {
  sc: SceneProps;
  children?: ReactNode;
  overlay?: ReactNode;
}) {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <Chrome world="paper" chapter={sc.chapter} source={SOURCE} t={t} />
      <Camera cam={sc.cam} t={t}>
        {sc.panes.map((p) => (
          <Pane key={p.id} spec={p} t={t} />
        ))}
        {children}
      </Camera>
      <Caps caps={sc.caps} world="paper" />
      {overlay}
    </AbsoluteFill>
  );
}

const rectOf = (sc: SceneProps, pane: string, rect: string): Box | null =>
  sc.panes.find((p) => p.id === pane)?.rects[rect] ?? null;

/** A small ledger tile in the right rail: a bidder and the state of the hold. */
function HoldTile({
  t,
  a,
  x,
  y,
  w,
  name,
  note,
}: {
  t: number;
  a: number;
  x: number;
  y: number;
  w: number;
  name: string;
  note: string;
}) {
  const p = pr(t, a, 0.7);
  if (p <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x + (1 - p) * 60,
        top: y,
        width: w,
        height: 96,
        border: `1.5px solid ${INK}`,
        opacity: p,
        background: PAPER,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 6,
          height: '100%',
          background: ORANGE,
        }}
      />
      <Mono x={22} y={14} w={w - 40} size={15} color={MUTE}>
        {name}
      </Mono>
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 40,
          fontFamily: DISPLAY,
          fontWeight: 800,
          textTransform: 'uppercase',
          fontSize: 40,
          lineHeight: '40px',
          color: INK,
        }}
      >
        Hold <span style={{ color: ORANGE }}>held</span>
      </div>
      <Mono x={22} y={76} w={w - 40} size={12} color={MUTE} upper={false}>
        {note}
      </Mono>
    </div>
  );
}

/* ---------- 5. open: /try, then the hub ---------- */
export function Open({ sc }: P) {
  return <Stage sc={sc} />;
}

/* ---------- 6. join ---------- */
export function Join({ sc }: P) {
  return <Stage sc={sc} />;
}

/* ---------- 7. hold: ceiling, the 3 second press, held not charged ---------- */
export function Hold({ sc }: P) {
  const t = useT();
  const box = rectOf(sc, 'phoneA', 'holdA.hold');
  const press = sc.ev.press ?? 6;
  const released = sc.ev.released ?? press + 3.4;
  const held = sc.ev.held ?? released + 0.8;
  return (
    <Stage
      sc={sc}
      overlay={
        <>
          <HoldTile
            t={t}
            a={held + 0.4}
            x={1392}
            y={640}
            w={464}
            name="Paddle 1. Asha. Phone"
            note="A PayPal authorization in a live room. Simulated here."
          />
          <Mono
            x={1392}
            y={768}
            w={464}
            size={15}
            color={MUTE}
            upper={false}
            opacity={pr(t, held + 1.0, 0.6)}
          >
            Simulated hold in this recording. Real sandbox holds are proven in G1 and G2
            (docs/GATES.md).
          </Mono>
        </>
      }
    >
      {box ? <Ring box={box} t={t} from={press} to={released} /> : null}
    </Stage>
  );
}

/* ---------- 8. bid: open the lot, then the ladder climbs ---------- */
export function Bid({ sc }: P) {
  const t = useT();
  const b = [sc.ev.b1 ?? 4.5, sc.ev.b2 ?? 7.5, sc.ev.b3 ?? 10.5];
  const rungs = [
    { at: b[0] + 0.9, amount: '$10.00', who: 'Paddle 1. Asha' },
    { at: b[1] + 0.9, amount: '$15.00', who: 'Paddle 2. Ben' },
    { at: b[2] + 0.9, amount: '$20.00', who: 'Paddle 1. Asha' },
  ];
  const shown = rungs.filter((r) => t >= r.at);
  const cut = sc.ev.cut ?? 3;
  return (
    <Stage
      sc={sc}
      overlay={
        <>
          {/* the ladder */}
          <div
            style={{
              position: 'absolute',
              left: 1392,
              top: 430,
              width: 464,
              opacity: pr(t, cut + 0.3, 0.5),
            }}
          >
            <Mono x={0} y={0} w={464} size={15} color={MUTE}>
              Bid ladder. Prices only go up
            </Mono>
            <Rule t={t} a={cut + 0.3} d={0.6} x={0} y={28} w={464} color={INK} />
            {rungs.map((r, i) => {
              const p = pr(t, r.at, 0.6);
              const lead = shown.length - 1 === i;
              const slot = Math.max(0, shown.length - 1 - i);
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 44 + slot * 78 + (1 - p) * 40,
                    width: 464,
                    height: 70,
                    opacity: p * (lead ? 1 : 0.55),
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      fontFamily: DISPLAY,
                      fontWeight: 800,
                      fontSize: 64,
                      lineHeight: '64px',
                      color: lead ? ORANGE : INK,
                    }}
                  >
                    {r.amount}
                  </div>
                  <Mono x={250} y={10} w={214} size={14} color={MUTE} align="right">
                    {r.who}
                  </Mono>
                  <Mono x={250} y={34} w={214} size={14} color={lead ? ORANGE : MUTE} align="right">
                    {lead ? 'Leading' : 'Outbid'}
                  </Mono>
                </div>
              );
            })}
          </div>
          {/* the two holds, small */}
          <HoldTile
            t={t}
            a={cut - 1.2}
            x={1392}
            y={748}
            w={224}
            name="Paddle 1. Asha"
            note="Phone, typed the code"
          />
          <HoldTile
            t={t}
            a={cut - 0.9}
            x={1632}
            y={748}
            w={224}
            name="Paddle 2. Ben"
            note="Phone, joined from the QR link"
          />
        </>
      }
    />
  );
}

/* ---------- 10. hammer ---------- */
export function Hammer({ sc }: P) {
  const t = useT();
  const box = rectOf(sc, 'console', 'hammer.hold');
  const press = sc.ev.press ?? 3;
  const released = sc.ev.released ?? press + 3.4;
  return <Stage sc={sc}>{box ? <Ring box={box} t={t} from={press} to={released} /> : null}</Stage>;
}

/* ---------- 12. receipt ---------- */
export function Receipt({ sc }: P) {
  return <Stage sc={sc} />;
}

/* ---------- 13. verify: the display word "broken" splits ---------- */
export function Verify({ sc }: P) {
  const t = useT();
  const broken = sc.ev.broken ?? 9;
  const split = pr(t, broken + 0.5, 0.5, IO);
  return (
    <Stage
      sc={sc}
      overlay={
        split > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: 1392,
              top: 150 + 2 * 68 + 20,
              width: 464,
              height: 3,
              background: ORANGE,
              transform: `translateX(${(split * 40).toFixed(1)}px) rotate(${(split * -2).toFixed(2)}deg)`,
              opacity: split,
            }}
          />
        ) : null
      }
    />
  );
}
