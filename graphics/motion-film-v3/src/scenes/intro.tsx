import { cl, EXIT, lerp, mix, pr, sp, usd } from '../anim';
import { Lockup, Mark, Waves } from '../brand';
import { LightSweep, Stage } from '../stage';
import { DIM, DISPLAY, INK, MONO, MUTE, ORANGE, ORANGE_DEEP, PAPER, PAPER_HI } from '../theme';
import { Display, Mono, Rise, Roll, Rule } from '../type';
import { Chip, HoldBar, Stamp } from '../ui';
import type { SceneCtx } from '../types';

const dollars = (v: number) => usd(v, true);

/* 1. hook: a price rolls to $500, the hatch sweeps over it, HELD stamps, charged counts down to $0.00,
   the mallet strikes and its rings wipe the frame. */
export function Hook({ t, frame, fps }: SceneCtx) {
  const strikeAt = 4.45;
  const dim = pr(t, 2.6, 0.6);
  const sweep = pr(t, 1.6, 0.7);
  const ringWipe = pr(t, strikeAt, 1.05, EXIT);
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      cam={[
        { at: 0, dur: 0, cam: { s: 1 } },
        { at: 0.2, dur: 5.3, cam: { s: 1.08, ry: -2 } },
      ]}
      over={
        <>
          <Waves t={t} strikes={[strikeAt]} x={960} y={540} size={300} n={3} dur={1.2} max={9} alpha={0.9} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: PAPER,
              opacity: ringWipe * 0.9,
              pointerEvents: 'none',
            }}
          />
        </>
      }
    >
      <Rule t={t} at={0} dur={0.5} x={360} y={539} w={1200} color={ORANGE} />
      {/* the hatch band behind the price */}
      <div style={{ position: 'absolute', left: 500, top: 330, opacity: 0.9 * (1 - dim * 0.6) }}>
        <HoldBar id="hookHatch" w={920} h={340} held={sweep} stroke="transparent" />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 300,
          display: 'flex',
          justifyContent: 'center',
          opacity: 1 - dim * 0.55,
          transform: `translateY(${(-dim * 60).toFixed(1)}px) scale(${(1 - dim * 0.12).toFixed(3)})`,
          color: PAPER,
        }}
      >
        <Roll t={t} steps={[{ at: 0.4, v: 50000 }]} fmt={dollars} size={380} first={1.0} />
      </div>
      <Stamp
        t={t}
        at={2.0}
        fps={fps}
        text="Held"
        size={96}
        style={{ left: 1180, top: 560, transformOrigin: '50% 50%' }}
      />
      {t >= 2.6 ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 700,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'center',
            gap: 28,
            opacity: pr(t, 2.6, 0.5),
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 28, letterSpacing: '0.14em', color: DIM }}>CHARGED</div>
          <div style={{ color: ORANGE }}>
            <Roll
              t={t}
              steps={[
                { at: 0, v: 50000 },
                { at: 2.75, v: 0 },
              ]}
              fmt={(v) => usd(v)}
              size={120}
              dur={0.9}
            />
          </div>
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: 830, top: 410, opacity: pr(t, strikeAt - 0.6, 0.2) }}>
        <Mark t={t - (strikeAt - 0.6)} size={260} ink={PAPER} timing={{ ringStart: -1, swingStart: 0, swingDur: 0.83 }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, textAlign: 'center' }}>
        <Mono
          t={t}
          at={2.4}
          text="A film by Harsh Bhanushali and Dhairya Patel"
          color={DIM}
          size={24}
          dur={1.2}
          style={{ display: 'inline-block' }}
        />
      </div>
    </Stage>
  );
}

/* 2. title: the lockup strikes on a tilted plane that levels, parallax rings behind, the tagline rises. */
export function Title({ t, frame, letters }: SceneCtx) {
  const tilt = mix(10, 0, t, 0.2, 2.2);
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={1}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.04 } },
        { at: 0, dur: 6, cam: { s: 1.0, ry: 1.5 } },
      ]}
    >
      {[300, 470, 660].map((r, i) => {
        const k = 1 + 0.03 * Math.sin(t * (0.8 + i * 0.2) + i);
        return (
          <div
            key={r}
            style={{
              position: 'absolute',
              left: 960 - r,
              top: 470 - r,
              width: 2 * r,
              height: 2 * r,
              borderRadius: '50%',
              border: `1px solid ${PAPER}`,
              opacity: 0.1 * pr(t, 0.3 + i * 0.2, 1.2),
              transform: `translateZ(${-300 - i * 220}px) scale(${k.toFixed(3)}) rotate(${(t * (4 + i * 2)).toFixed(1)}deg)`,
              filter: `blur(${2 + i * 1.5}px)`,
              borderTopColor: ORANGE,
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `rotateX(${tilt.toFixed(2)}deg)`,
          transformOrigin: '50% 45%',
        }}
      >
        <Lockup
          t={t}
          x={410}
          y={240}
          scale={1.6}
          letters={letters}
          ink={PAPER}
          timing={{ swingStart: 0.2, swingDur: 0.8 }}
          lettersAt={0.9}
        />
        <LightSweep t={t} at={1.6} alpha={0.12} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 660, textAlign: 'center' }}>
          <Display
            t={t}
            at={2.0}
            text="Every bid is a **hold.** / The hammer is the payment."
            size={104}
            color={PAPER}
            align="center"
          />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, textAlign: 'center' }}>
        <Mono
          t={t}
          at={3.4}
          text="Harsh Bhanushali and Dhairya Patel"
          color={DIM}
          size={24}
          dur={1.0}
          style={{ display: 'inline-block' }}
        />
      </div>
    </Stage>
  );
}

/* 3. problem: a dolly past three cards standing in depth; each enacts its line. */
export function Problem({ t, frame, fps }: SceneCtx) {
  const camZ = (() => {
    const a = pr(t, 2.3, 1.0, EXIT) * 0 + pr(t, 2.3, 1.0);
    const b = pr(t, 4.9, 1.0);
    return a * 900 + b * 900;
  })();
  const cards = [
    { n: '01', text: 'Charge first, / bidders **hold back.**', at: 0.3 },
    { n: '02', text: 'No hold, / winners **walk away.**', at: 2.9 },
    { n: '03', text: 'Paper sheets, / **no proof.**', at: 5.5 },
  ];
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={2}
      cam={[
        { at: 0, dur: 0, cam: { z: 0, ry: -4 } },
        { at: 2.3, dur: 1.0, cam: { z: 900, ry: 0 } },
        { at: 4.9, dur: 1.0, cam: { z: 1800, ry: 4 } },
      ]}
    >
      {cards.map((c, i) => {
        const z = -900 * i;
        const rel = z + camZ; // 0 when the camera is on this card
        const blur = Math.min(6, Math.abs(rel) / 220);
        const gone = cl((rel - 300) / 500);
        const x = 410 + (i - 1) * 120;
        return (
          <div
            key={c.n}
            style={{
              position: 'absolute',
              left: x,
              top: 250,
              width: 1100,
              height: 580,
              transform: `translateZ(${z}px)`,
              filter: `blur(${blur.toFixed(1)}px)`,
              opacity: 1 - gone,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(160deg, #2a211b, ${INK})`,
                border: '1px solid #4a3b31',
                borderRadius: 10,
                boxShadow: '0 50px 120px rgba(0,0,0,0.5)',
              }}
            />
            <div style={{ position: 'absolute', left: 64, top: 48, fontFamily: MONO, fontSize: 24, color: ORANGE, letterSpacing: '0.2em' }}>
              {c.n}
            </div>
            <div style={{ position: 'absolute', left: 64, top: 110 }}>
              <Display t={t} at={c.at} text={c.text} size={112} color={PAPER} />
            </div>
            {i === 0 ? (
              <div
                style={{
                  position: 'absolute',
                  right: 64,
                  top: 330,
                  transform: `translateY(${(pr(t, 1.5, 1.0) * 120).toFixed(1)}px)`,
                  opacity: 1 - pr(t, 1.5, 1.0) * 0.7,
                  color: PAPER,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 20,
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 22, color: DIM, letterSpacing: '0.14em' }}>CHARGED NOW</span>
                <Roll t={t} steps={[{ at: 0.5, v: 20000 }]} fmt={dollars} size={150} first={0.9} />
              </div>
            ) : null}
            {i === 1 ? (
              <div
                style={{
                  position: 'absolute',
                  left: 64,
                  top: 360,
                  width: 180,
                  height: 150,
                  borderRadius: 14,
                  background: PAPER_HI,
                  color: INK,
                  fontFamily: DISPLAY,
                  fontWeight: 900,
                  fontSize: 96,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: `translateX(${(pr(t, 4.1, 1.0, EXIT) * 1200).toFixed(1)}px) rotate(${(pr(t, 4.1, 1.0) * 14).toFixed(1)}deg)`,
                  opacity: 1 - pr(t, 4.6, 0.5),
                }}
              >
                12
              </div>
            ) : null}
            {i === 2 ? <Sheet t={t} at={6.6} /> : null}
            <Rule t={t} at={c.at + 0.2} x={64} y={520} w={972} color={ORANGE} thick={2} dur={1.2} />
          </div>
        );
      })}
      {/* the beat marks */}
      {[2.3, 4.9].map((b) => (
        <div
          key={b}
          style={{
            position: 'absolute',
            inset: 0,
            background: PAPER,
            opacity: 0.06 * (1 - cl((t - b) / 0.25)) * (t >= b ? 1 : 0),
          }}
        />
      ))}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 0, opacity: sp(t, 0, fps) * 0 }} />
    </Stage>
  );
}

/** A paper sheet of handwritten rows that tears along a diagonal at `at`. */
function Sheet({ t, at }: { t: number; at: number }) {
  const p = pr(t, at, 0.9);
  const rows = ['Lot 07  paddle 12  $350', 'Lot 07  paddle 7   $325', 'Lot 06  paddle 3   $90 ?', 'Lot 05  —  cash?'];
  const half = (which: 0 | 1) => (
    <div
      style={{
        position: 'absolute',
        left: 760,
        top: 330,
        width: 280,
        height: 200,
        background: PAPER_HI,
        color: INK,
        fontFamily: MONO,
        fontSize: 16,
        lineHeight: 1.9,
        padding: '14px 18px',
        borderRadius: 4,
        clipPath: which === 0 ? 'polygon(0 0, 100% 0, 100% 38%, 0 62%)' : 'polygon(0 62%, 100% 38%, 100% 100%, 0 100%)',
        transform:
          which === 0
            ? `translate(${(-p * 90).toFixed(1)}px, ${(-p * 60).toFixed(1)}px) rotate(${(-p * 9).toFixed(1)}deg)`
            : `translate(${(p * 70).toFixed(1)}px, ${(p * 90).toFixed(1)}px) rotate(${(p * 7).toFixed(1)}deg)`,
        opacity: 1 - pr(t, at + 0.7, 0.5) * 0.6,
      }}
    >
      {rows.map((r) => (
        <div key={r}>{r}</div>
      ))}
    </div>
  );
  return (
    <>
      {half(0)}
      {half(1)}
    </>
  );
}

/* 4. mechanism: the idea as a live diagram. A ceiling bar grows, bids climb under it, the mallet falls,
   the bar splits into a solid capture and a hollow release; the neighbour holds float off. */
export function Mechanism({ t, frame, fps }: SceneCtx) {
  const X = 300;
  const Y = 560;
  const BW = 1320;
  const BH = 72;
  const bids = [
    { at: 3.0, v: 20000, who: 'paddle 7' },
    { at: 3.9, v: 25000, who: 'paddle 12' },
    { at: 4.8, v: 30000, who: 'paddle 7' },
    { at: 5.7, v: 35000, who: 'paddle 12' },
  ];
  const strikeAt = 7.0;
  const held = pr(t, 0.8, 1.1);
  const cap = pr(t, 8.6, 0.7);
  const rel = pr(t, 9.3, 0.8);
  const posOf = (v: number) => X + (v / 50000) * BW;
  const captions = [
    { a: 0.6, b: 3.0, text: 'A **ceiling.**' },
    { a: 3.0, b: 6.5, text: 'Bids **under** it.' },
    { a: 6.5, b: 8.5, text: '**Hammer.**' },
    { a: 8.5, b: 13, text: 'Capture the **winner.** / Release the rest.' },
  ];
  return (
    <Stage
      t={t}
      frame={frame}
      world="paper"
      seed={3}
      cam={[
        { at: 0, dur: 0, cam: { rx: 14, s: 1.06, y: 40 } },
        { at: 0, dur: 13, cam: { rx: 0, s: 1.0, y: 0 } },
      ]}
    >
      <LightSweep t={t} at={7.2} alpha={0.5} color="#ffffff" />
      <div style={{ position: 'absolute', left: 120, top: 120 }}>
        {captions.map((c, i) =>
          t >= c.a && t <= c.b + 0.35 ? (
            <div key={i} style={{ position: 'absolute', left: 0, top: 0, width: 1400 }}>
              <Display t={t} at={c.a} out={c.b} text={c.text} size={128} color={INK} />
            </div>
          ) : null,
        )}
      </div>
      {/* the ceiling bar */}
      <div style={{ position: 'absolute', left: X, top: Y }}>
        <HoldBar id="mechBar" w={BW} h={BH} held={held} cap={cap} capFrac={0.7} release={rel} lift={70} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: X,
          top: Y - 44,
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: '0.14em',
          color: MUTE,
          opacity: pr(t, 0.9, 0.5),
        }}
      >
        CEILING, AUTHORIZED
      </div>
      <div style={{ position: 'absolute', left: X + BW + 36, top: Y - 36, color: INK }}>
        <Roll t={t} steps={[{ at: 0.9, v: 50000 }]} fmt={dollars} size={140} first={1.1} />
      </div>
      {/* bids climbing under the bar */}
      {bids.map((b, i) => {
        const s = sp(t, b.at, fps, { damping: 14, stiffness: 170 });
        if (s <= 0) return null;
        const x = posOf(b.v);
        const isLast = i === bids.length - 1;
        const fade = isLast ? 1 : 1 - pr(t, 8.6, 0.5) * 0.7;
        return (
          <div key={b.at} style={{ position: 'absolute', left: x, top: Y + BH + 24, opacity: fade }}>
            <div
              style={{
                position: 'absolute',
                left: -1,
                top: -24,
                width: 2,
                height: 24,
                background: INK,
                transform: `scaleY(${s.toFixed(3)})`,
                transformOrigin: '0 0',
              }}
            />
            <div
              style={{
                transform: `translate(-50%, ${((1 - s) * 40).toFixed(1)}px) scale(${lerp(0.8, 1, s).toFixed(3)})`,
                opacity: cl(s * 2),
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                width: 220,
              }}
            >
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 64, color: isLast && t > strikeAt ? ORANGE : INK, lineHeight: 1 }}>
                {dollars(b.v)}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 16, color: MUTE, letterSpacing: '0.1em' }}>{b.who}</div>
            </div>
          </div>
        );
      })}
      {/* the current price follows the ladder */}
      <div style={{ position: 'absolute', left: X, top: Y + BH + 170, display: 'flex', alignItems: 'baseline', gap: 20, opacity: pr(t, 2.8, 0.5) }}>
        <span style={{ fontFamily: MONO, fontSize: 18, color: MUTE, letterSpacing: '0.14em' }}>PRICE</span>
        <div style={{ color: INK }}>
          <Roll t={t} steps={bids.map((b) => ({ at: b.at, v: b.v }))} fmt={dollars} size={88} first={0.5} />
        </div>
      </div>
      {/* the mallet falls on $350 */}
      <div style={{ position: 'absolute', left: posOf(35000) - 110, top: Y - 290, opacity: pr(t, strikeAt - 0.7, 0.2) }}>
        <Mark t={t - (strikeAt - 0.62)} size={220} timing={{ ringStart: -1, swingStart: 0, swingDur: 0.86 }} />
      </div>
      <Waves t={t} strikes={[strikeAt]} x={posOf(35000)} y={Y + BH / 2} size={200} n={2} dur={1.3} max={7} alpha={0.7} />
      <Stamp t={t} at={9.0} fps={fps} text="Capture $350" size={56} style={{ left: X + 300, top: Y + 8 }} />
      {rel > 0 ? (
        <div style={{ position: 'absolute', left: posOf(35000) + 160, top: Y - 70 - rel * 70 + 14, opacity: rel }}>
          <Chip text="Released $150" tone="hollow" size={22} />
        </div>
      ) : null}
      {/* the neighbour holds */}
      {[
        { who: 'paddle 7, ceiling $400', v: 40000, at: 10.3 },
        { who: 'paddle 3, ceiling $100', v: 10000, at: 10.7 },
      ].map((h, i) => {
        const r = pr(t, h.at, 0.9);
        const show = pr(t, 1.8 + i * 0.3, 0.8);
        return (
          <div
            key={h.who}
            style={{
              position: 'absolute',
              left: X,
              top: Y + 330 + i * 70,
              opacity: show * (1 - r * 0.5),
              transform: `translateY(${(-r * 40).toFixed(1)}px)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <HoldBar id={`mechN${i}`} w={(h.v / 50000) * BW} h={30} held={show} release={r} />
              <span style={{ fontFamily: MONO, fontSize: 16, color: MUTE, letterSpacing: '0.1em' }}>{h.who}</span>
              {r > 0.5 ? <Chip text="Released" tone="hollow" size={13} /> : null}
            </div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 120, bottom: 48 }}>
        <Mono
          t={t}
          at={9.2}
          text="Orders v2 intent AUTHORIZE. Payments v2 capture, final_capture, void. Sandbox only."
          size={20}
          color={MUTE}
          dur={1.6}
        />
      </div>
    </Stage>
  );
}

export const introTitle = { Rise, ORANGE_DEEP };
