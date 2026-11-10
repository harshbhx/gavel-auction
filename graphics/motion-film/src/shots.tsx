// The paper world: the recorded app on a plane under a camera, captions beside it, and the brand
// components tied to the recorded events (the hold card, the big screen, the press rings, the tiles).
import type { ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { IO, pr, useT } from './anim';
import { BigScreen, ChapterTick, HoldCard } from './components';
import { Camera, Pane, Ring } from './pane';
import { DISPLAY, INK, MUTE, ORANGE, PAPER } from './theme';
import type { Box, SceneProps } from './types';
import { Caps, Chrome, Mono, SOURCE } from './ui';

type P = { sc: SceneProps; letters: string[] };
type Rect = { x: number; y: number; w: number; h?: number };

/** The stage of a recorded scene: chrome, camera with the panes and components, captions. */
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
      {sc.chapter ? <ChapterTick t={t} a={0.1} n={sc.chapter.n} x={1392} y={116} /> : null}
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

/* ---------- 7. hold: the hold card builds while the phone does the real thing ---------- */
export function Hold({ sc }: P) {
  const t = useT();
  const box = rectOf(sc, 'phoneA', 'holdA.hold');
  const press = sc.ev.press ?? 6;
  const released = sc.ev.released ?? press + 3.4;
  const held = sc.ev.held ?? released + 0.8;
  const ceiling = sc.ev.ceiling ?? 3;
  const card = (sc.data.card as Rect | undefined) ?? { x: 96, y: 200, w: 560 };
  const cents = (sc.data.ceilingCents as number | undefined) ?? 5000;
  return (
    <Stage
      sc={sc}
      overlay={
        <>
          <HoldCard
            t={t}
            x={card.x}
            y={card.y}
            w={card.w}
            state={{
              a: 0.4,
              name: 'Paddle 1. Asha. Phone',
              ceilingAt: ceiling + 0.2,
              ceiling: cents,
              press,
              released,
              held,
            }}
          />
          <Mono
            x={1392}
            y={700}
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

/* ---------- 8. bid: open the lot, then the phones beside the brand big screen ---------- */
export function Bid({ sc }: P) {
  const t = useT();
  const b = [sc.ev.b1 ?? 4.5, sc.ev.b2 ?? 7.5, sc.ev.b3 ?? 10.5];
  const cut = sc.ev.cut ?? 3;
  const screen = (sc.data.screen as Required<Rect> | undefined) ?? {
    x: 840,
    y: 170,
    w: 504,
    h: 660,
  };
  return (
    <Stage
      sc={sc}
      overlay={
        <>
          <HoldTile
            t={t}
            a={cut + 0.6}
            x={1392}
            y={748}
            w={224}
            name="Paddle 1. Asha"
            note="Phone, typed the code"
          />
          <HoldTile
            t={t}
            a={cut + 0.9}
            x={1632}
            y={748}
            w={224}
            name="Paddle 2. Ben"
            note="Phone, from the QR link"
          />
        </>
      }
    >
      <BigScreen
        t={t}
        x={screen.x}
        y={screen.y}
        w={screen.w}
        h={screen.h}
        state={{
          a: cut + 0.2,
          lot: 'Sandbox demo lot',
          bids: [
            [1000, b[0] + 0.8],
            [1500, b[1] + 0.8],
            [2000, b[2] + 0.8],
          ],
        }}
      />
    </Stage>
  );
}

/* ---------- 10. hammer, then the big screen names the winner ---------- */
export function Hammer({ sc }: P) {
  const t = useT();
  const box = rectOf(sc, 'console', 'hammer.hold');
  const press = sc.ev.press ?? 3;
  const released = sc.ev.released ?? press + 3.4;
  const cut = sc.ev.cut ?? 8.5;
  const screen = (sc.data.screen as Required<Rect> | undefined) ?? {
    x: 64,
    y: 140,
    w: 1280,
    h: 720,
  };
  return (
    <Stage sc={sc}>
      {box ? <Ring box={box} t={t} from={press} to={released} /> : null}
      <BigScreen
        t={t}
        x={screen.x}
        y={screen.y}
        w={screen.w}
        h={screen.h}
        state={{
          a: cut,
          lot: 'Sandbox demo lot',
          bids: [
            [1000, -3],
            [1500, -2],
            [2000, -1],
          ],
          soldAt: cut + 0.6,
          winner: 'paddle 1',
        }}
      />
    </Stage>
  );
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
              top: 150 + 68 + 20,
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
