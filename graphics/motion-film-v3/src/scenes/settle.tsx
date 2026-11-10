import { cl, EXIT, lerp, mix, pr, sp, usd } from '../anim';
import { Eyebrow, Footer, LightSweep, Stage } from '../stage';
import { BODY, DIM, DISPLAY, INK, INK_DEEP, MONO, MUTE, ORANGE, ORANGE_DEEP, PAPER, PAPER_HI, RULE_PAPER } from '../theme';
import { Caps, Mono, Roll } from '../type';
import { card, Chip, HoldBar, Phone, QR, Row } from '../ui';
import type { SceneCtx } from '../types';

/* 10. settle: three hold tiles on an isometric plane that levels; the winner's bar fills to the capture
   and the remainder goes hollow; the other two void; the journal types. */
export function Settle({ t, frame, fps, spec }: SceneCtx) {
  const tiles = [
    { who: 'Paddle 12, Asha', limit: 50000, kind: 'win' as const, at: 3.2, ref: '4F2A' },
    { who: 'Paddle 7, Ben', limit: 40000, kind: 'void' as const, at: 6.0, ref: '9C1D' },
    { who: 'Paddle 3, Chi', limit: 10000, kind: 'void' as const, at: 6.6, ref: '2B77' },
  ];
  const rx = mix(22, 0, t, 0.2, 3.2);
  const rz = mix(-8, 0, t, 0.2, 3.2);
  const journal = [
    { at: 7.2, s: 'capture   auth 4F2A   350.00   final_capture=true' },
    { at: 7.9, s: 'release   auth 4F2A   150.00   remainder, inferred from PayPal' },
    { at: 8.6, s: 'void      auth 9C1D   400.00' },
    { at: 9.3, s: 'void      auth 2B77   100.00' },
  ];
  return (
    <Stage
      t={t}
      frame={frame}
      world="paper"
      seed={9}
      cam={[{ at: 0, dur: 0, cam: { s: 1.0 } }, { at: 0, dur: 11, cam: { s: 1.05, x: -30 } }]}
      over={
        <>
          <Footer t={t} world="paper" text="Drawn, not recorded. Sandbox capture and void are proven in G1 and G4." />
          <Eyebrow t={t} world="paper" text="06  Settle" />
          <Caps t={t} caps={spec.caps} world="paper" x={96} y={300} size={120} width={760} />
        </>
      }
    >
      <div
        style={{
          position: 'absolute',
          left: 880,
          top: 150,
          width: 960,
          transform: `rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`,
          transformOrigin: '50% 50%',
        }}
      >
        <LightSweep t={t} at={7.0} alpha={0.6} color="#ffffff" />
        {tiles.map((tile, i) => {
          const show = sp(t, 0.3 + i * 0.18, fps, { damping: 18, stiffness: 110 });
          const w = 560;
          const capP = tile.kind === 'win' ? pr(t, tile.at, 0.8) : 0;
          const relP = tile.kind === 'win' ? pr(t, tile.at + 1.3, 0.9) : pr(t, tile.at, 0.9);
          return (
            <div
              key={tile.who}
              style={{
                ...card('paper'),
                position: 'relative',
                marginBottom: 22,
                padding: '22px 28px',
                transform: `translateY(${((1 - show) * 60).toFixed(1)}px)`,
                opacity: cl(show * 2) * (tile.kind === 'void' ? 1 - relP * 0.35 : 1),
                overflow: 'visible',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '0.14em', color: MUTE }}>{tile.who.toUpperCase()}</div>
                  <div style={{ fontFamily: BODY, fontSize: 18, color: INK, marginTop: 4 }}>
                    Limit {usd(tile.limit, true)} <span style={{ color: MUTE }}>held, ref {tile.ref}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {tile.kind === 'win' && capP > 0.3 ? <Chip text="Capture $350" tone="orange" size={13} style={{ opacity: cl((capP - 0.3) * 3) }} /> : null}
                  {tile.kind === 'win' && relP > 0.3 ? <Chip text="Released $150" tone="hollow" size={13} style={{ opacity: cl((relP - 0.3) * 3) }} /> : null}
                  {tile.kind === 'void' ? (
                    relP > 0.3 ? (
                      <Chip text="Void, released" tone="hollow" size={13} style={{ opacity: cl((relP - 0.3) * 3) }} />
                    ) : (
                      <Chip text="Held" tone="ink" size={13} />
                    )
                  ) : null}
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
                <HoldBar id={`settle${i}`} w={w * (tile.limit / 50000)} h={44} held={1} cap={capP} capFrac={0.7} release={relP} lift={26} />
                {tile.kind === 'win' ? (
                  <div style={{ color: ORANGE_DEEP }}>
                    <Roll t={t} steps={[{ at: 0, v: 0 }, { at: tile.at, v: 35000 }]} fmt={(v) => usd(v)} size={56} first={0.1} dur={0.8} />
                  </div>
                ) : (
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 56, color: MUTE, lineHeight: 1 }}>
                    {relP > 0.5 ? '$0.00' : usd(tile.limit)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div style={{ ...card('ink'), padding: '18px 26px', borderRadius: 8, minHeight: 150 }}>
          <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', color: DIM, marginBottom: 8 }}>JOURNAL</div>
          {journal.map((j) => (
            <Mono key={j.at} t={t} at={j.at} text={j.s} size={16} color={PAPER} dur={0.5} style={{ lineHeight: 1.7 }} />
          ))}
        </div>
      </div>
    </Stage>
  );
}

/* 11. receipt: a slip prints out of the phone with a share QR; then the ledger: a hash chain that
   verifies, is edited, and breaks. */
export function Receipt({ t, frame, fps, spec }: SceneCtx) {
  const printAt = 0.5;
  const wipe = pr(t, 6.0, 0.6);
  const rows: [string, string, boolean?][] = [
    ['Lot', '07 Press plate'],
    ['Winner', 'Paddle 12'],
    ['Held, Asha', '$500.00'],
    ['Winner settles', '$350.00', true],
    ['Released holds', '2 holds'],
    ['Ref', 'GV-7K2P-0312'],
  ];
  const chain = [
    ['01', 'room.open', '', 'a91f'],
    ['02', 'hold.held', '500.00', '3c7e'],
    ['03', 'hold.held', '400.00', 'd04b'],
    ['04', 'bid', '225.00', '77e2'],
    ['05', 'bid', '350.00', 'b6a1'],
    ['06', 'hammer', '350.00', '0f9c'],
    ['07', 'capture', '350.00', 'e55d'],
    ['08', 'void', '400.00', '2a40'],
    ['09', 'receipt', '', '5e1c'],
  ];
  const editAt = 9.0;
  const edit = pr(t, editAt, 0.4);
  const broken = pr(t, editAt + 0.5, 0.5);
  const verified = sp(t, 7.9, fps, { damping: 13, stiffness: 200 });
  return (
    <Stage
      t={t}
      frame={frame}
      world="paper"
      seed={10}
      cam={[{ at: 0, dur: 0, cam: { s: 1.02 } }, { at: 0, dur: 6, cam: { s: 1.06, ry: -3 } }, { at: 6, dur: 0.6, cam: { ry: 0, s: 1.0 } }, { at: 6.6, dur: 5.4, cam: { s: 1.05 } }]}
      over={
        <>
          <Footer t={t} world="paper" />
          <Eyebrow t={t} world="paper" text={t < 6 ? '07  Receipt' : '08  Verify'} />
          <Caps t={t} caps={spec.caps} world="paper" x={96} y={300} size={128} />
        </>
      }
    >
      {/* the phone and the slip */}
      <div style={{ position: 'absolute', left: 820, top: 110, opacity: 1 - wipe, transform: `translateX(${(-wipe * 200).toFixed(0)}px) rotateY(6deg)` }}>
        <Phone scale={0.86}>
          <div style={{ padding: '62px 22px 0' }}>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: ORANGE_DEEP }}>Sandbox: no real money moves</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 800 }}>Receipt</div>
              <Chip text="Simulated" tone="hollow" size={11} />
            </div>
          </div>
          <div style={{ margin: '18px 22px 0', position: 'relative' }}>
            <div
              style={{
                background: PAPER_HI,
                border: `2px solid ${INK}`,
                borderRadius: 4,
                padding: '6px 16px 14px',
                clipPath: `inset(0 0 ${(100 - pr(t, printAt, 1.8, (x) => x) * 100).toFixed(1)}% 0)`,
              }}
            >
              {rows.map((r, i) => (
                <div key={r[0]} style={{ opacity: pr(t, printAt + i * 0.22, 0.4), transform: `translateY(${((1 - pr(t, printAt + i * 0.22, 0.4)) * 10).toFixed(1)}px)` }}>
                  <Row k={r[0]} v={r[1]} strong={r[2]} size={15} />
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                <HoldBar id="receiptBar" w={318} h={26} held={1} cap={pr(t, 2.4, 0.6)} capFrac={0.7} release={pr(t, 2.9, 0.6)} lift={8} />
              </div>
              <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11, color: MUTE, lineHeight: 1.5, opacity: pr(t, 3.0, 0.5) }}>
                Simulated. Not a PayPal transaction. Sandbox only. Money is held, not charged, until the hammer. Losing holds are released.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18, opacity: pr(t, 3.5, 0.5) }}>
              <QR t={t} at={3.6} size={120} seed={11} n={21} />
              <div>
                <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', color: MUTE }}>SHARE</div>
                <div style={{ fontSize: 14, color: INK, marginTop: 4 }}>Open the receipt on any phone.</div>
                <div style={{ marginTop: 10, display: 'inline-block', padding: '8px 14px', borderRadius: 4, background: INK, color: PAPER_HI, fontFamily: DISPLAY, fontWeight: 700, fontSize: 18 }}>
                  Copy link
                </div>
              </div>
            </div>
          </div>
        </Phone>
      </div>
      {/* the ledger */}
      <div
        style={{
          position: 'absolute',
          left: 860,
          top: 110,
          width: 960,
          height: 880,
          clipPath: `inset(0 0 0 ${((1 - wipe) * 100).toFixed(1)}%)`,
          opacity: wipe > 0 ? 1 : 0,
        }}
      >
        <div style={{ ...card('ink'), position: 'absolute', inset: 0, borderRadius: 12, background: `linear-gradient(170deg, #2a211b, ${INK_DEEP})` }} />
        <div style={{ position: 'absolute', left: 36, top: 30, right: 36, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '0.14em', color: DIM }}>LEDGER EXPORT, PASTED</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 36, color: PAPER }}>Verify a ledger</div>
          </div>
          <div style={{ position: 'relative', height: 44, width: 260 }}>
            {verified > 0 && broken <= 0 ? (
              <div style={{ position: 'absolute', right: 0, transform: `scale(${lerp(1.5, 1, verified).toFixed(3)})`, opacity: cl(verified * 2) }}>
                <Chip text="Chain verified" tone="orange" size={15} />
              </div>
            ) : null}
            {broken > 0 ? (
              <>
                <div style={{ position: 'absolute', right: 130 + broken * 16, transform: `rotate(${(-broken * 6).toFixed(1)}deg)` }}>
                  <Chip text="Chain" tone="hollow" size={15} style={{ color: ORANGE, borderColor: ORANGE }} />
                </div>
                <div style={{ position: 'absolute', right: 0 - broken * 10, top: broken * 8, transform: `rotate(${(broken * 5).toFixed(1)}deg)` }}>
                  <Chip text="broken" tone="hollow" size={15} style={{ color: ORANGE, borderColor: ORANGE }} />
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div style={{ position: 'absolute', left: 36, right: 36, top: 120 }}>
          {chain.map((r, i) => {
            const s = sp(t, 6.4 + i * 0.12, fps, { damping: 16, stiffness: 160 });
            const isEdit = i === 4;
            const down = i > 4;
            const shake = down ? Math.sin((t - editAt) * 40 + i) * 6 * Math.max(0, 1 - (t - editAt - 0.4) / 0.6) * (t > editAt + 0.4 ? 1 : 0) : 0;
            const hollow = down ? broken : 0;
            return (
              <div key={r[0]} style={{ position: 'relative' }}>
                {i > 0 ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: 22,
                      top: -14,
                      width: 2,
                      height: 14,
                      background: hollow > 0.5 ? ORANGE : DIM,
                      transform: `scaleY(${s.toFixed(2)})`,
                      transformOrigin: '0 0',
                      opacity: 1 - hollow * 0.5,
                    }}
                  />
                ) : null}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '48px 160px 1fr 160px',
                    alignItems: 'center',
                    gap: 12,
                    height: 58,
                    marginBottom: 14,
                    padding: '0 16px',
                    borderRadius: 6,
                    border: hollow > 0.5 ? `2px dashed ${ORANGE}` : `1px solid #4a3b31`,
                    background: isEdit && edit > 0 ? `rgba(255,106,31,${(0.25 * edit).toFixed(2)})` : '#241c16',
                    color: PAPER,
                    fontFamily: MONO,
                    fontSize: 17,
                    transform: `translateX(${((1 - s) * 60 + shake).toFixed(1)}px)`,
                    opacity: cl(s * 2) * (1 - hollow * 0.45),
                  }}
                >
                  <span style={{ color: DIM }}>{r[0]}</span>
                  <span>{r[1]}</span>
                  <span style={{ color: isEdit && edit > 0.5 ? ORANGE : PAPER, fontWeight: isEdit && edit > 0.5 ? 700 : 400 }}>
                    {isEdit && edit > 0.5 ? '349.00' : r[2]}
                    {isEdit && edit > 0.5 ? <span style={{ color: DIM, fontSize: 13 }}>  edited</span> : null}
                  </span>
                  <span style={{ color: hollow > 0.5 ? ORANGE : DIM, textAlign: 'right' }}>{hollow > 0.5 ? 'mismatch' : `${r[3]}…`}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ position: 'absolute', left: 36, bottom: 26 }}>
          <Mono t={t} at={8.2} text={t < editAt ? 'Each entry hashes the one before. Head 5e1c… matches the room.' : 'Entry 05 was edited. Every hash after it no longer matches.'} size={15} color={DIM} dur={0.6} />
        </div>
      </div>
    </Stage>
  );
}

export const settleUtil = { EXIT, RULE_PAPER, BODY, DIM };
