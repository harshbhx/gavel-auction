import type { CSSProperties } from 'react';
import { cl, EXIT, lerp, mix, pr, press, pulse, sp, usd } from '../anim';
import { Mark, Waves } from '../brand';
import { Eyebrow, Footer, LightSweep, Stage } from '../stage';
import { BODY, DIM, DISPLAY, INK, INK_DEEP, MONO, MUTE, ORANGE, ORANGE_DEEP, PAPER, PAPER_HI, RULE_PAPER } from '../theme';
import { Caps, Display, Mono, Roll, type Step } from '../type';
import { card, Chip, HoldBar, Phone, PhoneTop, QR, RingButton, Stamp, Waveform } from '../ui';
import type { SceneCtx } from '../types';

const dollars = (v: number) => usd(v, true);
const LOT = 'Lot 07';
const LOT_NAME = 'Signed press plate, 1923';

/** A preset bid button of the bidder screen. */
function Preset({ t, at, label, primary }: { t: number; at?: number; label: string; primary?: boolean }) {
  const k = at === undefined ? 0 : press(t, at);
  return (
    <div
      style={{
        flex: 1,
        height: 64,
        borderRadius: 6,
        border: `2px solid ${INK}`,
        background: primary ? ORANGE : PAPER_HI,
        color: primary ? '#1a0a00' : INK,
        fontFamily: DISPLAY,
        fontWeight: 800,
        fontSize: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `${3 - 3 * k}px ${3 - 3 * k}px 0 ${INK}`,
        transform: `translate(${(3 * k).toFixed(1)}px, ${(3 * k).toFixed(1)}px)`,
      }}
    >
      {label}
    </div>
  );
}

/** The bidder screen inside a phone. */
function BidderScreen({
  t,
  price,
  leader,
  you,
  limit,
  taps,
}: {
  t: number;
  price: Step[];
  leader: (t: number) => number;
  you: number;
  limit: number;
  taps: { at: number; i: number }[];
}) {
  const cur = price.filter((s) => s.at <= t).pop()?.v ?? price[0].v;
  const lead = leader(t);
  const mine = taps.filter((x) => x.at <= t).length;
  return (
    <>
      <PhoneTop title={LOT} sub={LOT_NAME} />
      <div style={{ padding: '26px 22px 0' }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.12em', color: MUTE }}>PRICE</div>
        <div style={{ color: INK, marginTop: 2 }}>
          <Roll t={t} steps={price} fmt={dollars} size={92} first={0.6} dur={0.45} />
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Chip text={lead === you ? `Leading: paddle ${lead} (you)` : `Leading: paddle ${lead}`} tone={lead === you ? 'orange' : 'ink'} size={12} />
        </div>
        <div style={{ marginTop: 34, fontFamily: MONO, fontSize: 12, letterSpacing: '0.12em', color: MUTE }}>YOUR HOLD</div>
        <div style={{ marginTop: 8 }}>
          <HoldBar id={`bidderHold${you}`} w={346} h={30} held={1} cap={1} capFrac={cl(cur / limit) * (lead === you ? 1 : mine > 0 ? 1 : 0)} />
        </div>
        <div style={{ marginTop: 8, fontSize: 14, color: MUTE }}>
          Your highest bid {dollars(lead === you ? cur : Math.min(cur, limit))} of your {dollars(limit)} limit
        </div>
        <div style={{ marginTop: 40, display: 'flex', gap: 10 }}>
          <Preset t={t} at={taps.find((x) => x.i === 0 && t >= x.at - 0.01 && t < x.at + 0.5)?.at} label="+$25" />
          <Preset t={t} at={taps.find((x) => x.i === 1 && t >= x.at - 0.01 && t < x.at + 0.5)?.at} label="+$50" primary />
          <Preset t={t} at={taps.find((x) => x.i === 2 && t >= x.at - 0.01 && t < x.at + 0.5)?.at} label="+$100" />
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: MUTE, lineHeight: 1.5 }}>
          Your bid never goes above your limit. Held, not charged.
        </div>
      </div>
    </>
  );
}

/* 5. join: a phone flies in, the room code types, the QR builds; the code flies to the big screen behind. */
export function Join({ t, frame, fps, spec }: SceneCtx) {
  const code = '7K2P';
  const fly = sp(t, 0.2, fps, { damping: 18, stiffness: 90 });
  const typed = Math.floor(cl((t - 1.2) / 1.4) * 4.999);
  const found = pr(t, 3.4, 0.6);
  const flyChip = pr(t, 3.5, 0.7);
  const screenBlur = mix(7, 0, t, 3.4, 0.9);
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={4}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0 } },
        { at: 0, dur: 7, cam: { s: 1.06, ry: -2 } },
      ]}
      over={
        <>
          <Footer t={t} world="ink" />
          <Eyebrow t={t} world="ink" text="01  Join" />
          <Caps t={t} caps={spec.caps} world="ink" x={96} y={330} size={128} />
        </>
      }
    >
      {/* the big screen, far behind */}
      <div
        style={{
          position: 'absolute',
          left: 700,
          top: 150,
          width: 760,
          height: 620,
          transform: 'translateZ(-650px) rotateY(-6deg)',
          filter: `blur(${screenBlur.toFixed(1)}px)`,
          opacity: pr(t, 0.3, 1.0),
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(170deg, #2a211b, ${INK_DEEP})`, border: '1px solid #4a3b31', borderRadius: 12 }} />
        <div style={{ position: 'absolute', left: 44, top: 40, fontFamily: MONO, fontSize: 18, letterSpacing: '0.14em', color: DIM }}>ROOM SCREEN</div>
        <div style={{ position: 'absolute', left: 44, top: 84, fontFamily: DISPLAY, fontWeight: 800, fontSize: 56, color: PAPER }}>{LOT}</div>
        <div style={{ position: 'absolute', left: 44, top: 150, fontFamily: BODY, fontSize: 20, color: DIM }}>{LOT_NAME}</div>
        <div style={{ position: 'absolute', left: 44, top: 240, fontFamily: MONO, fontSize: 18, letterSpacing: '0.14em', color: DIM }}>JOIN WITH THE CODE</div>
        <div
          style={{
            position: 'absolute',
            left: 44,
            top: 280,
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 150,
            letterSpacing: '0.12em',
            color: ORANGE,
            opacity: flyChip,
          }}
        >
          {code}
        </div>
        <div style={{ position: 'absolute', right: 44, top: 240 }}>
          <QR t={t} at={4.2} size={260} seed={3} />
        </div>
        <div style={{ position: 'absolute', left: 44, bottom: 36, fontFamily: MONO, fontSize: 16, color: DIM }}>
          or scan the QR
        </div>
      </div>
      {/* the flying code (shared element) */}
      {flyChip > 0 && flyChip < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: lerp(1330, 980, flyChip),
            top: lerp(470, 390, flyChip),
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: lerp(44, 100, flyChip),
            letterSpacing: '0.12em',
            color: ORANGE,
            transform: `translateZ(${(-650 * flyChip).toFixed(0)}px)`,
          }}
        >
          {code}
        </div>
      ) : null}
      {/* the phone */}
      <div
        style={{
          position: 'absolute',
          left: 1240,
          top: 180,
          transform: `translateX(${((1 - fly) * 420).toFixed(1)}px) rotateY(${((1 - fly) * 32 - 6).toFixed(2)}deg)`,
          transformOrigin: '50% 50%',
          opacity: cl(fly * 2),
        }}
      >
        <Phone scale={0.82}>
          <PhoneTop title="Join a room" sub="Type the code from the screen" />
          <div style={{ padding: '36px 22px 0' }}>
            <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.12em', color: MUTE }}>ROOM CODE</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              {code.split('').map((ch, i) => {
                const on = i < typed;
                const k = sp(t, 1.2 + i * 0.35, fps, { damping: 12, stiffness: 260 });
                return (
                  <div
                    key={i}
                    style={{
                      width: 76,
                      height: 90,
                      border: `2px solid ${INK}`,
                      borderRadius: 6,
                      background: on ? PAPER_HI : 'transparent',
                      fontFamily: DISPLAY,
                      fontWeight: 900,
                      fontSize: 56,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: `scale(${on ? lerp(1.18, 1, k).toFixed(3) : 1})`,
                      boxShadow: on ? `3px 3px 0 ${INK}` : 'none',
                    }}
                  >
                    {on ? ch : ''}
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 26,
                height: 60,
                borderRadius: 6,
                background: ORANGE,
                color: '#1a0a00',
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `2px solid ${INK}`,
                boxShadow: `${3 - 3 * press(t, 3.0)}px ${3 - 3 * press(t, 3.0)}px 0 ${INK}`,
                transform: `translate(${(3 * press(t, 3.0)).toFixed(1)}px, ${(3 * press(t, 3.0)).toFixed(1)}px)`,
              }}
            >
              Find room
            </div>
            <div style={{ marginTop: 28, opacity: found, transform: `translateY(${((1 - found) * 24).toFixed(1)}px)` }}>
              <div style={{ ...card('paper'), padding: 18 }}>
                <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', color: MUTE }}>ROOM FOUND</div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, marginTop: 6 }}>{LOT}</div>
                <div style={{ fontSize: 14, color: MUTE }}>{LOT_NAME}</div>
                <div style={{ marginTop: 12 }}>
                  <Chip text="Your paddle is 12" tone="orange" />
                </div>
              </div>
            </div>
            <div style={{ marginTop: 20, fontSize: 12, color: MUTE, textAlign: 'center' }}>Or scan the QR on the screen</div>
          </div>
        </Phone>
      </div>
    </Stage>
  );
}

/* 6. hold: the ceiling slider, the 3 s hold button with its ring, the camera dolly into the press, the
   hold card that flips to Held. */
export function Hold({ t, frame, fps, spec }: SceneCtx) {
  const slide = pr(t, 0.8, 1.6);
  const limit = Math.round(lerp(100, 500, slide) / 50) * 50;
  const pressAt = 3.8;
  const heldAt = pressAt + 3;
  const held = pr(t, heldAt, 0.6);
  const flip = pr(t, heldAt, 0.7);
  const phoneIn = sp(t, 0.1, fps, { damping: 18, stiffness: 90 });
  return (
    <Stage
      t={t}
      frame={frame}
      world="paper"
      seed={5}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0 } },
        { at: 0.2, dur: 3.4, cam: { s: 1.03 } },
        { at: 3.5, dur: 0.9, cam: { s: 1.22, x: 60, y: -180 } },
        { at: heldAt + 0.1, dur: 1.0, cam: { s: 1.02, x: 0, y: 0 } },
      ]}
      vignette={pr(t, 3.5, 0.9) * (1 - pr(t, heldAt + 0.1, 1.0))}
      over={
        <>
          <Footer t={t} world="paper" />
          <Eyebrow t={t} world="paper" text="02  Hold" />
          <Caps t={t} caps={spec.caps} world="paper" x={96} y={330} size={128} />
        </>
      }
    >
      <div
        style={{
          position: 'absolute',
          left: 700,
          top: 120,
          transform: `rotateY(${(-10 + (1 - phoneIn) * 30).toFixed(2)}deg) translateX(${((1 - phoneIn) * 200).toFixed(1)}px)`,
          transformOrigin: '50% 50%',
          opacity: cl(phoneIn * 2),
        }}
      >
        <Phone scale={0.92}>
          <PhoneTop title={LOT} sub="Step 2 of 3. Choose your limit" />
          <div style={{ padding: '26px 22px 0' }}>
            <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.12em', color: MUTE }}>YOUR LIMIT</div>
            <div style={{ color: INK }}>
              <Roll t={t} steps={[{ at: 0, v: 10000 }, ...Array.from({ length: 8 }, (_, i) => ({ at: 0.8 + ((i + 1) / 8) * 1.6, v: 10000 + (i + 1) * 5000 }))]} fmt={dollars} size={96} first={0.1} dur={0.2} />
            </div>
            {/* the slider */}
            <div style={{ position: 'relative', height: 44, marginTop: 10 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 18, height: 8, borderRadius: 4, background: RULE_PAPER, border: `1px solid ${INK}` }} />
              <div style={{ position: 'absolute', left: 0, top: 18, height: 8, width: `${slide * 100}%`, borderRadius: 4, background: '#f5b488' }} />
              <div
                style={{
                  position: 'absolute',
                  left: `calc(${slide * 100}% - 22px)`,
                  top: 0,
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: ORANGE,
                  border: `2px solid ${INK}`,
                  boxShadow: `2px 2px 0 ${INK}`,
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 12, color: MUTE }}>
              <span>$100</span>
              <span>$500</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              {[100, 250, 500].map((v) => (
                <div
                  key={v}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 4,
                    border: `2px solid ${INK}`,
                    background: limit === v ? INK : 'transparent',
                    color: limit === v ? PAPER_HI : INK,
                    fontFamily: MONO,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ${v}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 26, fontSize: 14, color: MUTE, lineHeight: 1.5 }}>
              Held, not charged. Your limit is set aside on PayPal and released if you do not win.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
              <RingButton
                t={t}
                pressAt={pressAt}
                size={220}
                label={
                  <span>
                    Approve a
                    <br />
                    PayPal hold
                  </span>
                }
                done={<span>Held</span>}
              />
            </div>
            <div style={{ marginTop: 14, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: MUTE }}>
              Press and hold 3 seconds
            </div>
          </div>
        </Phone>
      </div>
      {/* the hold card */}
      <div
        style={{
          position: 'absolute',
          left: 1210,
          top: 250,
          width: 600,
          transform: `rotateY(${(-8 * (1 - pr(t, 0.4, 1.2))).toFixed(2)}deg) translateY(${((1 - pr(t, 0.4, 1.0)) * 40).toFixed(1)}px)`,
          opacity: pr(t, 0.4, 0.8),
        }}
      >
        <div style={{ ...card('paper'), padding: 32, position: 'relative', overflow: 'hidden' }}>
          <LightSweep t={t} at={heldAt + 0.2} alpha={0.7} color="#ffffff" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: '0.14em', color: MUTE }}>YOUR HOLD</div>
            <div style={{ transform: `rotateX(${(flip * 360).toFixed(1)}deg)` }}>
              <Chip text={flip > 0.5 ? 'Held' : t >= pressAt ? 'Authorize' : 'Not placed'} tone={flip > 0.5 ? 'orange' : t >= pressAt ? 'ink' : 'hollow'} size={14} />
            </div>
          </div>
          <div style={{ color: INK, marginTop: 10 }}>
            <Roll t={t} steps={[{ at: 0, v: 10000 }, ...Array.from({ length: 8 }, (_, i) => ({ at: 0.8 + ((i + 1) / 8) * 1.6, v: 10000 + (i + 1) * 5000 }))]} fmt={dollars} size={150} first={0.1} dur={0.2} />
          </div>
          <div style={{ marginTop: 10 }}>
            <HoldBar id="holdCardBar" w={536} h={56} held={held} />
          </div>
          <div style={{ marginTop: 20, fontFamily: BODY, fontSize: 22, color: INK, minHeight: 60 }}>
            <Display t={t} at={heldAt + 0.3} text="**Held,** not charged." size={54} color={INK} />
          </div>
          <div style={{ marginTop: 10, minHeight: 28 }}>
            <Mono t={t} at={heldAt + 0.9} text="Reference ending 4F2A. Orders v2 intent AUTHORIZE. Sandbox." size={16} color={MUTE} dur={1.4} />
          </div>
        </div>
      </div>
    </Stage>
  );
}

/* 7. bid: two phones beside the big screen; chips fly phone -> ladder, the price rolls, the leader flips. */
export function Bid({ t, frame, fps, spec }: SceneCtx) {
  const bids = [
    { at: 3.0, v: 22500, who: 12, side: 'A' as const, i: 0 },
    { at: 4.8, v: 25000, who: 7, side: 'B' as const, i: 0 },
    { at: 6.6, v: 30000, who: 12, side: 'A' as const, i: 1 },
    { at: 8.4, v: 32500, who: 7, side: 'B' as const, i: 0 },
    { at: 10.2, v: 35000, who: 12, side: 'A' as const, i: 1 },
  ];
  const FLY = 0.55;
  const price: Step[] = [{ at: 0, v: 20000 }, ...bids.map((b) => ({ at: b.at + FLY, v: b.v }))];
  const leader = (tt: number) => bids.filter((b) => b.at + FLY <= tt).pop()?.who ?? 0;
  const openAt = 1.4;
  const open = pr(t, openAt, 0.6);
  // camera: a gentle turn toward the phone that taps
  const cam = bids.flatMap((b) => [
    { at: b.at - 0.05, dur: 0.4, cam: { ry: b.side === 'A' ? 5 : -5, x: b.side === 'A' ? 60 : -60 } },
    { at: b.at + 0.9, dur: 0.8, cam: { ry: 0, x: 0 } },
  ]);
  const flash = bids.reduce((m, b) => Math.max(m, pulse(t, b.at + FLY, 100) * (t < b.at + FLY + 0.5 ? 1 : 0)), 0);
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={6}
      cam={[{ at: 0, dur: 0, cam: { s: 1.02 } }, { at: 0, dur: 14, cam: { s: 1.06 } }, ...cam]}
      over={
        <>
          <Footer t={t} world="ink" />
          <Eyebrow t={t} world="ink" text="03  Bid" />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 850, textAlign: 'center' }}>
            {spec.caps.map((c, i) =>
              t >= c.a && t <= c.b + 0.35 ? (
                <div key={i} style={{ position: 'absolute', left: 0, right: 0 }}>
                  <Display t={t} at={c.a} out={c.b} text={c.text.replace(' / ', ' ')} size={96} color={PAPER} align="center" />
                </div>
              ) : null,
            )}
          </div>
        </>
      }
    >
      {/* the big screen */}
      <div style={{ position: 'absolute', left: 620, top: 90, width: 680, height: 720, transform: 'translateZ(-80px)' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(170deg, #2a211b, ${INK_DEEP})`,
            border: '1px solid #4a3b31',
            borderRadius: 14,
            boxShadow: `0 40px 120px rgba(0,0,0,0.5), 0 0 ${60 * flash}px ${ORANGE}`,
          }}
        />
        <div style={{ position: 'absolute', left: 40, top: 34, display: 'flex', justifyContent: 'space-between', right: 40, alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44, color: PAPER }}>{LOT}</div>
            <div style={{ fontFamily: BODY, fontSize: 17, color: DIM }}>{LOT_NAME}</div>
          </div>
          <div style={{ transform: `rotateX(${(open * 360).toFixed(0)}deg)` }}>
            <Chip text={open > 0.5 ? 'Bidding open' : 'Ready'} tone={open > 0.5 ? 'orange' : 'paper'} size={14} />
          </div>
        </div>
        <div style={{ position: 'absolute', left: 40, top: 140, fontFamily: MONO, fontSize: 16, letterSpacing: '0.14em', color: DIM }}>
          {t < openAt + 0.6 ? 'OPENING BID' : 'CURRENT PRICE'}
        </div>
        <div style={{ position: 'absolute', left: 36, top: 160, color: PAPER }}>
          <Roll t={t} steps={price} fmt={dollars} size={200} first={0.8} dur={0.45} />
        </div>
        <div style={{ position: 'absolute', left: 40, top: 380 }}>
          <Leader t={t} leader={leader} bids={bids} fly={FLY} />
        </div>
        <div style={{ position: 'absolute', left: 40, top: 450, right: 40, fontFamily: MONO, fontSize: 14, letterSpacing: '0.14em', color: DIM }}>
          LATEST BIDS
        </div>
        <div style={{ position: 'absolute', left: 40, right: 40, top: 480 }}>
          {[...bids].reverse().map((b) => {
            const s = sp(t, b.at + FLY, fps, { damping: 15, stiffness: 180 });
            if (s <= 0) return null;
            const rank = bids.filter((x) => x.at > b.at && x.at + FLY <= t).length;
            return (
              <div
                key={b.at}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: rank * 48,
                  height: 40,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0 14px',
                  borderRadius: 6,
                  background: rank === 0 ? ORANGE : '#2d231c',
                  color: rank === 0 ? '#1a0a00' : PAPER,
                  fontFamily: BODY,
                  fontSize: 18,
                  transform: `translateY(${((1 - s) * -30).toFixed(1)}px) scale(${lerp(0.9, 1, s).toFixed(3)})`,
                  opacity: cl(s * 2) * (rank > 3 ? 0 : 1),
                  transition: 'none',
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 15, letterSpacing: '0.08em' }}>paddle {b.who}</span>
                <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26 }}>{dollars(b.v)}</span>
              </div>
            );
          })}
        </div>
        <div style={{ position: 'absolute', right: 40, bottom: 28, fontFamily: MONO, fontSize: 14, color: DIM }}>Join 7K2P</div>
        <div style={{ position: 'absolute', left: 40, bottom: 28, fontFamily: MONO, fontSize: 14, color: DIM }}>Sandbox: no real money moves</div>
      </div>
      {/* flying chips */}
      {bids.map((b) => {
        const p = pr(t, b.at, FLY, (x) => x * x * (3 - 2 * x));
        if (t < b.at || p >= 1) return null;
        const x0 = b.side === 'A' ? 300 : 1620;
        const y0 = 620;
        const x1 = 960;
        const y1 = 260;
        const arc = Math.sin(Math.PI * p) * -140;
        return (
          <div
            key={b.at}
            style={{
              position: 'absolute',
              left: lerp(x0, x1, p),
              top: lerp(y0, y1, p) + arc,
              transform: `translate(-50%, -50%) scale(${lerp(1, 1.5, p).toFixed(2)})`,
              fontFamily: DISPLAY,
              fontWeight: 900,
              fontSize: 44,
              color: '#1a0a00',
              background: ORANGE,
              padding: '6px 16px',
              borderRadius: 8,
              boxShadow: `0 10px 30px rgba(0,0,0,0.4)`,
            }}
          >
            {dollars(b.v)}
          </div>
        );
      })}
      {/* phones */}
      {(['A', 'B'] as const).map((side) => {
        const you = side === 'A' ? 12 : 7;
        const left = side === 'A' ? 110 : 1470;
        const inP = sp(t, side === 'A' ? 0.1 : 0.3, fps, { damping: 18, stiffness: 90 });
        return (
          <div
            key={side}
            style={{
              position: 'absolute',
              left,
              top: 150,
              transform: `translateX(${((1 - inP) * (side === 'A' ? -300 : 300)).toFixed(1)}px) rotateY(${side === 'A' ? 18 : -18}deg)`,
              transformOrigin: '50% 50%',
              opacity: cl(inP * 2),
            }}
          >
            <Phone scale={0.72}>
              <BidderScreen
                t={t}
                price={price}
                leader={leader}
                you={you}
                limit={side === 'A' ? 500 : 400}
                taps={bids.filter((b) => b.side === side).map((b) => ({ at: b.at, i: b.i }))}
              />
            </Phone>
            <div style={{ position: 'absolute', left: 0, top: 650, fontFamily: MONO, fontSize: 15, letterSpacing: '0.12em', color: DIM }}>
              {side === 'A' ? 'BIDDER A, PADDLE 12' : 'BIDDER B, PADDLE 7, FROM THE QR'}
            </div>
          </div>
        );
      })}
    </Stage>
  );
}

function Leader({ t, leader, bids, fly }: { t: number; leader: (t: number) => number; bids: { at: number; who: number }[]; fly: number }) {
  const lead = leader(t);
  const last = bids.filter((b) => b.at + fly <= t).pop();
  const flip = last ? pr(t, last.at + fly, 0.5) : 1;
  return (
    <div style={{ transform: `rotateX(${((1 - flip) * 90).toFixed(1)}deg)`, transformOrigin: '50% 100%', fontFamily: BODY, fontSize: 24, color: PAPER }}>
      {lead ? (
        <span>
          Leading: <span style={{ color: ORANGE, fontWeight: 700 }}>paddle {lead}</span>
        </span>
      ) : (
        <span style={{ color: DIM }}>No bids yet</span>
      )}
    </div>
  );
}

/* 8. voice: the waveform reacts to the words, the transcript types, parse chips rise, the confirm card lands. */
export function Voice({ t, frame, fps, spec }: SceneCtx) {
  const words = [
    { at: 2.6, w: 'three' },
    { at: 3.1, w: 'fifty' },
    { at: 3.7, w: 'for' },
    { at: 4.0, w: 'paddle' },
    { at: 4.5, w: 'twelve' },
  ];
  const level = words.reduce((m, w) => Math.max(m, Math.exp(-Math.pow((t - w.at - 0.18) / 0.22, 2))), 0) * 0.95 + (t > 1 && t < 5.4 ? 0.06 : 0.02);
  const transcript = words.filter((w) => w.at <= t).map((w) => w.w).join(' ');
  const parsed = pr(t, 5.1, 0.6);
  const confirm = sp(t, 5.7, fps, { damping: 16, stiffness: 120 });
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={7}
      cam={[{ at: 0, dur: 0, cam: { s: 1.0 } }, { at: 0, dur: 9, cam: { s: 1.05, ry: 2 } }]}
      over={
        <>
          <Footer t={t} world="ink" text="Always a confirm step. Assist mode. Measured on synthetic clips only (G5 partial)." />
          <Eyebrow t={t} world="ink" text="04  Voice" />
          <Caps t={t} caps={spec.caps} world="ink" x={96} y={300} size={112} width={820} />
        </>
      }
    >
      <div
        style={{
          position: 'absolute',
          left: 980,
          top: 150,
          width: 840,
          transform: `rotateY(${(-6 * (1 - pr(t, 0.2, 1.2))).toFixed(2)}deg)`,
          opacity: pr(t, 0.2, 0.8),
        }}
      >
        <div style={{ ...card('ink'), padding: 32, borderRadius: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: '0.14em', color: DIM }}>AUCTIONEER MICROPHONE</div>
            <Chip text={t < 5.4 ? 'Listening' : 'Heard'} tone={t < 5.4 ? 'orange' : 'paper'} size={13} style={{ opacity: 0.7 + 0.3 * pulse(t, 1.0, 1.0) }} />
          </div>
          <div style={{ marginTop: 24 }}>
            <Waveform t={t} level={level} w={776} h={170} />
          </div>
          <div style={{ marginTop: 18, minHeight: 44, fontFamily: BODY, fontSize: 30, color: PAPER }}>
            {transcript ? <span>&ldquo;{transcript}&rdquo;</span> : <span style={{ color: DIM }}>&nbsp;</span>}
            {t > 2.4 && t < 5.2 ? <span style={{ color: ORANGE }}>|</span> : null}
          </div>
          <div style={{ marginTop: 22, display: 'flex', gap: 12, minHeight: 40 }}>
            {[
              { k: 'amount', v: '350.00' },
              { k: 'paddle', v: '12' },
              { k: 'conf', v: '0.92' },
            ].map((c, i) => {
              const s = sp(t, 5.0 + i * 0.12, fps, { damping: 13, stiffness: 220 });
              if (s <= 0) return null;
              return (
                <div
                  key={c.k}
                  style={{
                    fontFamily: MONO,
                    fontSize: 16,
                    letterSpacing: '0.06em',
                    color: PAPER,
                    border: `2px solid ${ORANGE}`,
                    borderRadius: 4,
                    padding: '8px 14px',
                    transform: `translateY(${((1 - s) * 30).toFixed(1)}px) scale(${lerp(0.8, 1, s).toFixed(3)})`,
                    opacity: cl(s * 2),
                  }}
                >
                  <span style={{ color: DIM }}>{c.k} </span>
                  {c.v}
                </div>
              );
            })}
          </div>
          {confirm > 0 ? (
            <div
              style={{
                marginTop: 24,
                ...card('paper'),
                padding: 24,
                transform: `translateY(${((1 - confirm) * 50).toFixed(1)}px) scale(${lerp(0.94, 1, confirm).toFixed(3)})`,
                opacity: cl(confirm * 2),
              }}
            >
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, color: INK, lineHeight: 1.05 }}>
                Did you mean <span style={{ color: ORANGE_DEEP }}>$350</span> for paddle 12?
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
                <div
                  style={{
                    flex: 1,
                    height: 56,
                    borderRadius: 6,
                    background: ORANGE,
                    border: `2px solid ${INK}`,
                    color: '#1a0a00',
                    fontFamily: DISPLAY,
                    fontWeight: 800,
                    fontSize: 26,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: `3px 3px 0 ${INK}`,
                    transform: `scale(${(1 + 0.04 * pulse(t, 6.3, 1.0)).toFixed(3)})`,
                  }}
                >
                  Confirm
                </div>
                <div style={{ flex: 1, height: 56, borderRadius: 6, border: `2px solid ${INK}`, color: INK, fontFamily: DISPLAY, fontWeight: 700, fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  No
                </div>
              </div>
              <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 13, color: MUTE }}>Nothing counts until you confirm.</div>
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 96, top: 700 }}>
        <Mono t={t} at={6.4} text="Speech by Deepgram or Groq. The parser never accepts a bid on its own." size={18} color={DIM} dur={1.4} />
      </div>
    </Stage>
  );
}

/* 9. hammer: the hold-to-hammer ring fills over 3 s, the camera dollies in, the flash, the strike, SOLD. */
export function Hammer({ t, frame, fps, spec }: SceneCtx) {
  const pressAt = 2.0;
  const soldAt = pressAt + 3;
  const kick = Math.sin(Math.PI * cl((t - soldAt) / 0.3)) * (t >= soldAt ? 1 : 0);
  const flash = t >= soldAt ? Math.max(0, 1 - (t - soldAt) / 0.14) : 0;
  const after = pr(t, soldAt, 0.01);
  const goingStyle: CSSProperties = { fontFamily: MONO, fontSize: 18, letterSpacing: '0.16em', color: DIM };
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={8}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0 } },
        { at: pressAt - 0.3, dur: 3.2, cam: { s: 1.14, x: -120, y: 40 } },
        { at: soldAt, dur: 0.05, cam: { s: 1.18 } },
        { at: soldAt + 0.05, dur: 1.2, cam: { s: 1.02, x: 0, y: 0 } },
      ]}
      vignette={pr(t, pressAt - 0.3, 3.0) * (1 - pr(t, soldAt, 0.8))}
      over={
        <>
          <Footer t={t} world="ink" />
          <Eyebrow t={t} world="ink" text="05  Hammer" />
          <Caps t={t} caps={spec.caps} world="ink" x={96} y={300} size={128} />
          <div style={{ position: 'absolute', inset: 0, background: PAPER, opacity: flash, pointerEvents: 'none' }} />
          <Waves t={t} strikes={[soldAt]} x={1290} y={560} size={320} n={3} dur={1.4} max={8} alpha={0.9} />
        </>
      }
    >
      <div
        style={{
          position: 'absolute',
          left: 800,
          top: 110,
          width: 1000,
          height: 860,
          transform: `rotateY(${(-5 * (1 - pr(t, 0.2, 1.2))).toFixed(2)}deg) scale(${(1 + kick * 0.02).toFixed(3)})`,
          opacity: pr(t, 0.2, 0.7),
        }}
      >
        <div style={{ ...card('paper'), position: 'absolute', inset: 0, borderRadius: 12 }} />
        <div style={{ position: 'absolute', left: 40, top: 32, right: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '0.14em', color: MUTE }}>AUCTIONEER CONSOLE</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 40, color: INK, marginTop: 4 }}>
              {LOT} <span style={{ color: MUTE, fontWeight: 500, fontSize: 24 }}>{LOT_NAME}</span>
            </div>
          </div>
          <div style={{ transform: `rotateX(${(after * 360).toFixed(0)}deg)` }}>
            <Chip text={after ? 'Sold' : 'Bidding open'} tone={after ? 'orange' : 'ink'} size={14} />
          </div>
        </div>
        <div style={{ position: 'absolute', left: 40, top: 120, width: 380 }}>
          <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '0.14em', color: MUTE }}>LEADING</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 120, color: after ? ORANGE_DEEP : INK, lineHeight: 1 }}>$350</div>
          <div style={{ fontFamily: BODY, fontSize: 20, color: INK }}>paddle 12, Asha</div>
          <div style={{ marginTop: 26, fontFamily: MONO, fontSize: 13, letterSpacing: '0.14em', color: MUTE }}>BID STREAM</div>
          {[
            ['paddle 12', '$350'],
            ['paddle 7', '$325'],
            ['paddle 12', '$300'],
            ['paddle 7', '$250'],
            ['paddle 12', '$225'],
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${RULE_PAPER}`, fontFamily: BODY, fontSize: 17, color: INK, opacity: pr(t, 0.6 + i * 0.1, 0.5) * (i === 0 ? 1 : 0.75) }}>
              <span style={{ fontFamily: MONO, fontSize: 14, color: MUTE }}>{r[0]}</span>
              <span style={{ fontWeight: 600 }}>{r[1]}</span>
            </div>
          ))}
          <div style={{ marginTop: 22, ...goingStyle, opacity: pr(t, 3.0, 0.3) }}>GOING ONCE</div>
          <div style={{ marginTop: 8, ...goingStyle, opacity: pr(t, 4.0, 0.3) }}>GOING TWICE</div>
        </div>
        <div style={{ position: 'absolute', left: 520, top: 150, width: 440, textAlign: 'center' }}>
          <div style={{ fontFamily: BODY, fontSize: 20, color: INK, lineHeight: 1.4, minHeight: 60 }}>
            Press and hold 3 seconds to close the lot.
            <br />
            <span style={{ color: MUTE, fontSize: 16 }}>Falls at the current price. Release early to cancel.</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 34 }}>
            <RingButton t={t} pressAt={pressAt} size={340} label={<span>Hold to hammer</span>} done={<span>Sold</span>} />
          </div>
        </div>
        <div style={{ position: 'absolute', left: 600, top: 150, opacity: pr(t, soldAt - 0.62, 0.1) * (1 - pr(t, soldAt + 1.6, 0.5)) }}>
          <Mark t={t - (soldAt - 0.62)} size={300} timing={{ ringStart: -1, swingStart: 0, swingDur: 0.86 }} />
        </div>
        <Stamp t={t} at={soldAt + 0.1} fps={fps} text="Sold" size={140} style={{ left: 560, top: 560 }} />
        {t > soldAt + 0.6 ? (
          <div style={{ position: 'absolute', left: 520, top: 740, width: 440, textAlign: 'center' }}>
            <Display t={t} at={soldAt + 0.6} text="to **paddle 12** / at $350" size={54} color={INK} align="center" />
          </div>
        ) : null}
      </div>
    </Stage>
  );
}

export const roomUtil = { EXIT, DIM, PAPER_HI, INK_DEEP };
