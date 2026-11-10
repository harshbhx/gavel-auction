// The ink world: type and graphics only. Every component is a pure function of the scene time.
import { AbsoluteFill } from 'remotion';
import { cl, IO, lerp, pr, useT, EXIT } from './anim';
import { Lockup, Mark, strikeTime, Waves } from './brand';
import { Pane } from './pane';
import { DIM, DISPLAY, INK, MONO, ORANGE, PALE, PAPER, W, worldColors } from './theme';
import type { SceneProps } from './types';
import { Body, Chrome, Em, Mono, Rise, Rule, Wipe } from './ui';

type P = { sc: SceneProps; letters: string[] };
const paper = worldColors('paper');

/** Mono text that types itself from `a` at `cps` characters a second, with a blinking cursor. */
function Typed({
  t,
  a,
  text,
  x,
  y,
  size = 34,
  cps = 28,
  color = PAPER,
  cursor = true,
  out,
}: {
  t: number;
  a: number;
  text: string;
  x: number;
  y: number;
  size?: number;
  cps?: number;
  color?: string;
  cursor?: boolean;
  out?: number;
}) {
  if (t < a || (out !== undefined && t >= out)) return null;
  const n = Math.min(text.length, Math.floor((t - a) * cps));
  const blink = Math.floor(t * 2) % 2 === 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        fontFamily: MONO,
        fontWeight: 500,
        fontSize: size,
        lineHeight: `${Math.round(size * 1.4)}px`,
        color,
        whiteSpace: 'pre',
      }}
    >
      {text.slice(0, n)}
      {cursor ? (
        <span
          style={{
            display: 'inline-block',
            width: size * 0.55,
            height: size * 1.05,
            background: ORANGE,
            verticalAlign: 'text-bottom',
            opacity: blink ? 1 : 0.15,
            marginLeft: 4,
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- 1. cold open ---------- */
export function Cold(_p: P) {
  const t = useT();
  const timing = { swingStart: 2.7, swingDur: 0.85 };
  const strike = strikeTime(timing);
  const markIn = pr(t, 2.5, 0.3);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Typed t={t} a={0.3} text="A bid is a promise." x={96} y={470} size={44} out={1.9} />
      <Typed t={t} a={1.95} text="Most bids cost nothing." x={96} y={470} size={44} out={2.75} />
      <div style={{ position: 'absolute', left: 860, top: 440, opacity: markIn }}>
        <Mark t={t} size={200} ink={PAPER} timing={timing} />
      </div>
      <Waves t={t} strikes={[strike]} x={960} y={540} size={260} max={9} dur={1.2} />
      <Mono x={96} y={1000} w={1000} size={17} color={DIM} opacity={pr(t, 0.6, 0.6)}>
        A film by Harsh Bhanushali and Dhairya Patel
      </Mono>
      <Mono x={1056} y={1000} w={768} size={17} color={DIM} align="right" opacity={pr(t, 0.6, 0.6)}>
        GAVEL. PayPal Hackathon 2026
      </Mono>
    </AbsoluteFill>
  );
}

/* ---------- 2. title ---------- */
export function Title({ letters }: P) {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Chrome world="ink" t={t} />
      <Lockup t={t} x={96} y={150} scale={1.5} letters={letters} ink={PAPER} />
      <Rule t={t} a={1.1} d={0.9} x={96} y={520} w={1728} color={PAPER} />
      <Rise t={t} a={1.25} d={0.9} x={90} y={560} w={1750} size={210} color={PAPER}>
        Every bid is a <span style={{ color: ORANGE }}>hold.</span>
      </Rise>
      <Rise t={t} a={1.6} d={0.9} x={92} y={760} w={1750} size={150} color={PAPER}>
        The hammer is the payment.
      </Rise>
      <Mono x={96} y={930} w={1200} size={20} color={DIM} opacity={pr(t, 2.3, 0.6)}>
        Live voice-bid auctions where every bid is a PayPal authorization hold
      </Mono>
    </AbsoluteFill>
  );
}

/* ---------- 3. problem ---------- */
const ROWS: [string, string][] = [
  ['Charge a card up front,', 'and bidders **hold back.**'],
  ['Leave bids unsecured,', 'and winners **walk away.**'],
  ['Shout bids on paper,', 'and the record is **hard to trust.**'],
];
export function Problem(_p: P) {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Chrome world="ink" t={t} />
      {ROWS.map((r, i) => {
        const y = 136 + i * 286;
        const a = 0.4 + i * 2.9;
        const act = a + 1.7; // the enacted motion of the row
        // row 1 sinks, row 2 slides off to the right, row 3 tears its rule
        const sink = i === 0 ? pr(t, act, 0.7, IO) : 0;
        const slide = i === 1 ? pr(t, act, 0.7, EXIT) : 0;
        const tear = i === 2 ? pr(t, act, 0.6, IO) : 0;
        const dim = 1 - 0.55 * Math.max(sink, slide, tear);
        return (
          <div
            key={i}
            style={{ position: 'absolute', left: 0, top: sink * 26, width: W, opacity: dim }}
          >
            {i === 2 ? (
              <>
                <Rule t={t} a={a} d={0.7} x={96} y={y} w={860 - tear * 28} color={PAPER} />
                <div
                  style={{
                    position: 'absolute',
                    left: 956 + tear * 28,
                    top: y + tear * 10,
                    width: 868 - tear * 28,
                    height: 1.5,
                    background: PAPER,
                    opacity: pr(t, a + 0.3, 0.4),
                    transform: `rotate(${(tear * 1.2).toFixed(2)}deg)`,
                    transformOrigin: '0 50%',
                  }}
                />
              </>
            ) : (
              <Rule t={t} a={a} d={0.7} x={96} y={y} w={1728} color={PAPER} />
            )}
            <Rise t={t} a={a + 0.1} x={96} y={y + 30} w={80} size={24} f="m" color={DIM}>
              0{i + 1}
            </Rise>
            <Rise t={t} a={a + 0.15} d={0.8} x={240} y={y + 24} w={1560} size={104} color={PAPER}>
              {r[0]}
            </Rise>
            <div style={{ position: 'absolute', left: slide * 700, top: 0, opacity: 1 - slide }}>
              <Rise t={t} a={a + 0.3} d={0.8} x={240} y={y + 122} w={1560} size={104} color={PAPER}>
                <Em text={r[1]} />
              </Rise>
            </div>
            {i === 0 ? (
              <Rise
                t={t}
                a={a + 0.5}
                d={0.3}
                x={1500}
                y={y + 40}
                w={324}
                size={120}
                align="right"
                color={ORANGE}
              >
                ${Math.round(lerp(0, 200, pr(t, a + 0.5, 0.9)))}
              </Rise>
            ) : null}
          </div>
        );
      })}
      <Rule t={t} a={7.6} d={0.6} x={96} y={136 + 3 * 286 - 6} w={1728} color={PAPER} />
    </AbsoluteFill>
  );
}

/* ---------- 4. the idea: ceiling, bids under it, capture the winner, release the rest ---------- */
export function Idea(_p: P) {
  const t = useT();
  const bx = 200;
  const by = 200;
  const bw = 170;
  const bh = 600;
  const fill = pr(t, 1.0, 1.2);
  const bids = [
    { c: 1000, a: 2.8, label: '$10' },
    { c: 1500, a: 3.5, label: '$15' },
    { c: 2000, a: 4.2, label: '$20' },
  ];
  const hammer = pr(t, 5.6, 0.5);
  const split = pr(t, 6.6, 0.9, IO);
  const level = (frac: number) => by + bh - frac * bh;
  const winFrac = 0.4;
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Wipe t={t} a={0} d={0.7} color={PAPER} />
      <Chrome world="paper" t={t} a={0.5} />
      {/* the ceiling bar */}
      <div
        style={{
          position: 'absolute',
          left: bx,
          top: by,
          width: bw,
          height: bh,
          border: `1.5px solid ${INK}`,
          opacity: pr(t, 0.8, 0.4),
        }}
      />
      {/* the hold fill rises, then splits at the hammer */}
      <div
        style={{
          position: 'absolute',
          left: bx,
          top: level(fill) + split * 0,
          width: bw,
          height: bh * fill * (1 - split * (1 - winFrac)),
          background: split > 0 ? ORANGE : PALE,
          opacity: 1,
        }}
      />
      {split > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: bx,
            top: level(1) - split * 90,
            width: bw,
            height: bh * (1 - winFrac),
            background: PALE,
            opacity: 1 - split,
          }}
        />
      ) : null}
      <Rise t={t} a={1.0} x={bx} y={by - 64} w={700} size={26} f="m" color={paper.mute}>
        Hold. The ceiling this bidder approves
      </Rise>
      {bids.map((b, i) => {
        const p = pr(t, b.a, 0.5);
        const yy = level(b.c / 5000);
        return (
          <div key={i} style={{ opacity: p }}>
            <div
              style={{
                position: 'absolute',
                left: bx - 20,
                top: yy,
                width: (bw + 40) * p,
                height: 3,
                background: INK,
              }}
            />
            <Rise t={t} a={b.a} d={0.5} x={bx + bw + 36} y={yy - 30} w={300} size={60} color={INK}>
              {b.label}
            </Rise>
          </div>
        );
      })}
      {/* hammer line */}
      <div
        style={{
          position: 'absolute',
          left: bx - 60,
          top: level(winFrac) - 3,
          width: (bw + 120) * hammer,
          height: 7,
          background: ORANGE,
        }}
      />
      <Rise
        t={t}
        a={5.7}
        d={0.5}
        x={bx + bw + 36}
        y={level(winFrac) + 28}
        w={400}
        size={24}
        f="m"
        color={ORANGE}
      >
        Hammer at $20
      </Rise>
      {split > 0 ? (
        <>
          <Rise
            t={t}
            a={6.8}
            d={0.6}
            x={bx}
            y={level(winFrac) + 70}
            w={600}
            size={26}
            f="m"
            color={ORANGE}
          >
            Capture $20.00. final_capture
          </Rise>
          <Rise t={t} a={7.4} d={0.6} x={bx} y={by - 20} w={600} size={26} f="m" color={paper.mute}>
            The rest is released
          </Rise>
        </>
      ) : null}
      {/* the words */}
      <Rise t={t} a={1.0} d={0.8} x={1000} y={200} w={824} size={110} color={INK}>
        Authorize a <span style={{ color: ORANGE }}>ceiling.</span>
      </Rise>
      <Rise t={t} a={2.7} d={0.8} x={1000} y={330} w={824} size={110} color={INK}>
        Bid <span style={{ color: ORANGE }}>under</span> it.
      </Rise>
      <Rise t={t} a={5.7} d={0.8} x={1000} y={460} w={824} size={110} color={INK}>
        Capture only the <span style={{ color: ORANGE }}>winner.</span>
      </Rise>
      <Rise t={t} a={7.3} d={0.8} x={1000} y={590} w={824} size={110} color={INK}>
        Release the rest.
      </Rise>
      <Rule t={t} a={8.0} d={0.7} x={1000} y={730} w={824} color={INK} />
      <Body t={t} a={8.2} x={1000} y={752} w={824} size={27} color={paper.mute}>
        PayPal Orders v2 with intent AUTHORIZE holds the ceiling. At the hammer, Payments v2
        captures the winning price with final_capture and voids every other hold.
      </Body>
    </AbsoluteFill>
  );
}

/* ---------- 9. voice (illustration, labelled) ---------- */
export function Voice(_p: P) {
  const t = useT();
  const bars = 140;
  const draw = pr(t, 0.9, 2.2, (x) => x);
  const x0 = 96;
  const wid = 1728;
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Chrome world="ink" t={t} />
      <Rise t={t} a={0.3} d={0.8} x={90} y={130} w={1750} size={150} color={PAPER}>
        Or <span style={{ color: ORANGE }}>say</span> it.
      </Rise>
      <div style={{ position: 'absolute', left: x0, top: 330, width: wid, height: 220 }}>
        {Array.from({ length: bars }, (_, i) => {
          const u = i / bars;
          if (u > draw) return null;
          // a speech-shaped envelope: three syllable groups, deterministic
          const env =
            Math.max(0, Math.sin(u * Math.PI * 3.2)) *
            (0.55 + 0.45 * Math.sin(u * 23 + 1.3)) *
            (0.6 + 0.4 * Math.abs(Math.sin(u * 61 + 0.4)));
          const h = 8 + env * 200;
          const recent = cl(1 - (draw - u) * 6);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: (i / bars) * wid,
                top: 110 - h / 2,
                width: Math.max(4, wid / bars - 5),
                height: h,
                background: recent > 0.5 ? ORANGE : PAPER,
                opacity: 0.4 + 0.6 * env,
              }}
            />
          );
        })}
      </div>
      <Typed
        t={t}
        a={1.6}
        text='"three fifty for paddle twelve"'
        x={96}
        y={590}
        size={42}
        cps={16}
      />
      {[
        { x: 96, label: 'amount', value: '350.00' },
        { x: 560, label: 'paddle', value: '12' },
      ].map((c, i) => {
        const a = 4.1 + i * 0.25;
        const p = pr(t, a, 0.6);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: c.x,
              top: 700 + (1 - p) * 20,
              width: 420,
              height: 110,
              border: `1.5px solid ${PAPER}`,
              opacity: p,
            }}
          >
            <Mono x={24} y={16} size={16} color={DIM}>
              {c.label}
            </Mono>
            <div
              style={{
                position: 'absolute',
                left: 24,
                top: 40,
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 56,
                lineHeight: '56px',
                color: PAPER,
              }}
            >
              {c.value}
            </div>
          </div>
        );
      })}
      {(() => {
        const p = pr(t, 5.5, 0.7);
        const ok = pr(t, 7.0, 0.4);
        return (
          <div
            style={{
              position: 'absolute',
              left: 1040,
              top: 700 + (1 - p) * 20,
              width: 784,
              height: 110,
              border: `1.5px solid ${PAPER}`,
              opacity: p,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 24,
                top: 18,
                width: 520,
                fontFamily: "'Public Sans Variable', system-ui, sans-serif",
                fontWeight: 600,
                fontSize: 27,
                lineHeight: '36px',
                color: PAPER,
              }}
            >
              Did you mean $350 for paddle 12?
            </div>
            <div
              style={{
                position: 'absolute',
                right: 20,
                top: 24,
                width: 200,
                height: 62,
                border: `2px solid ${ORANGE}`,
                background: ok > 0 ? ORANGE : 'transparent',
                color: ok > 0 ? INK : ORANGE,
                fontFamily: MONO,
                fontWeight: 700,
                fontSize: 20,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: `scale(${(1 - 0.04 * Math.sin(Math.PI * ok)).toFixed(3)})`,
              }}
            >
              {ok > 0 ? 'Confirmed' : 'Confirm'}
            </div>
          </div>
        );
      })()}
      <Mono x={96} y={930} w={1728} size={18} color={ORANGE} opacity={pr(t, 0.8, 0.6)}>
        Illustration, not a recording. Speech is measured on 24 synthetic clips only (G5 partial).
        No bid is accepted without a confirm.
      </Mono>
    </AbsoluteFill>
  );
}

/* ---------- 11. settle: capture the winner, release the rest ---------- */
function Tile({
  t,
  x,
  y,
  w,
  name,
  state,
  sweep,
  journal,
  jAt,
}: {
  t: number;
  x: number;
  y: number;
  w: number;
  name: string;
  state: [string, string];
  sweep: number;
  journal: string;
  jAt: number;
}) {
  const orange = state[1].startsWith('Capture');
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: 220,
        border: `1.5px solid ${PAPER}`,
        overflow: 'hidden',
        opacity: orange ? 1 : 1 - 0.45 * sweep,
      }}
    >
      {orange ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: `${(sweep * 100).toFixed(1)}%`,
            height: '100%',
            background: ORANGE,
          }}
        />
      ) : null}
      <Mono x={28} y={22} size={20} color={orange && sweep > 0.5 ? INK : DIM}>
        {name}
      </Mono>
      <div
        style={{
          position: 'absolute',
          left: 28,
          top: 64,
          width: w - 56,
          height: 100,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 800,
            textTransform: 'uppercase',
            fontSize: 96,
            lineHeight: '100px',
            color: orange ? (sweep > 0.5 ? INK : PAPER) : PAPER,
            transform: `translateY(${(-sweep * 100).toFixed(1)}%)`,
          }}
        >
          <div>{state[0]}</div>
          <div>{state[1]}</div>
        </div>
      </div>
      <Mono
        x={28}
        y={176}
        w={w - 56}
        size={16}
        color={orange && sweep > 0.5 ? INK : DIM}
        upper={false}
        opacity={pr(t, jAt, 0.5)}
      >
        {journal}
      </Mono>
    </div>
  );
}
export function Settle(_p: P) {
  const t = useT();
  const sweepA = pr(t, 2.2, 0.9, IO);
  const sweepB = pr(t, 3.6, 0.9, IO);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Chrome world="ink" t={t} />
      <Rise t={t} a={0.3} d={0.8} x={90} y={130} w={1750} size={120} color={PAPER}>
        Capture only the <span style={{ color: ORANGE }}>winning price.</span>
      </Rise>
      <Rise t={t} a={3.4} d={0.8} x={90} y={240} w={1750} size={120} color={PAPER}>
        Release every other hold.
      </Rise>
      <div style={{ opacity: pr(t, 0.9, 0.5) }}>
        <Tile
          t={t}
          x={96}
          y={430}
          w={840}
          name="Paddle 1. Asha. Winner at $20.00"
          state={['Hold', 'Capture $20.00']}
          sweep={sweepA}
          journal="capture 2000 cents, final_capture: true. Order COMPLETED. The rest of the hold is released."
          jAt={3.0}
        />
        <Tile
          t={t}
          x={984}
          y={430}
          w={840}
          name="Paddle 2. Ben. Outbid"
          state={['Hold', 'Released']}
          sweep={sweepB}
          journal="void. Authorization VOIDED. Nothing was charged."
          jAt={4.4}
        />
      </div>
      <Rule t={t} a={5.2} d={0.7} x={96} y={720} w={1728} color={PAPER} />
      <Body t={t} a={5.4} x={96} y={744} w={1728} size={27} color={DIM}>
        A journaled settlement saga does this at the hammer. If the process dies halfway, it asks
        PayPal what is true and continues instead of repeating a capture.
      </Body>
      <Mono x={96} y={930} w={1728} size={18} color={ORANGE} opacity={pr(t, 0.8, 0.6)}>
        Drawn, not recorded. The holds in this film are simulated. Real sandbox capture, remainder
        release and void are proven in G1 and G4 (docs/GATES.md).
      </Mono>
    </AbsoluteFill>
  );
}

/* ---------- 14. proof ---------- */
const EVID = [
  {
    w: 'Kill survived',
    n: null,
    t: 'A real server kill during settlement, on the PayPal sandbox: one capture, two holds voided, a ledger of 19 entries that verifies.',
    s: 'docs/GATES.md. Run 42558021614',
  },
  {
    w: 'Live voice {n} of 24',
    n: 24,
    t: 'Both speech providers answered 24 of 24 synthetic clips through the live socket. No bid accepted without a confirm.',
    s: 'docs/GATES.md. Run 42575018866. Synthetic audio only',
  },
  {
    w: 'Webhooks {n} of 6',
    n: 6,
    t: 'Six real PayPal sandbox deliveries, each verified SUCCESS against the webhook id: approved, authorized, captured, voided.',
    s: 'docs/GATES.md. Run 41947655945',
  },
  {
    w: 'Latency, honestly',
    n: null,
    t: 'Hammer to captured p95 3.8 s against a 2.5 s target. Hammer to settled p95 6.9 s against 6 s. Both missed.',
    s: 'docs/GATES.md. Run 42563147792. 49 of 50 runs, incomplete',
  },
];
export function Proof(_p: P) {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Chrome world="ink" t={t} />
      {EVID.map((r, i) => {
        const y = 128 + i * 218;
        const a = 0.4 + i * 2.6;
        const count = r.n === null ? '' : String(Math.round(lerp(0, r.n, pr(t, a + 0.3, 0.9))));
        return (
          <div key={i}>
            <Rule t={t} a={a} d={0.7} x={96} y={y} w={1728} color={PAPER} />
            <Rise t={t} a={a + 0.1} x={96} y={y + 28} w={70} size={22} f="m" color={DIM}>
              0{i + 1}
            </Rise>
            <Rise t={t} a={a + 0.1} d={0.8} x={170} y={y + 22} w={840} size={100} color={PAPER}>
              {r.w.replace('{n}', count)}
            </Rise>
            <Body t={t} a={a + 0.35} x={1060} y={y + 26} w={764} size={28} color={PAPER}>
              {r.t}
            </Body>
            <Mono
              x={1060}
              y={y + 176}
              w={764}
              size={15}
              color={DIM}
              upper={false}
              opacity={pr(t, a + 0.5, 0.5)}
            >
              {r.s}
            </Mono>
          </div>
        );
      })}
      <Rule t={t} a={11.0} d={0.5} x={96} y={128 + 4 * 218 - 6} w={1728} color={PAPER} />
    </AbsoluteFill>
  );
}

/* ---------- 15. for judges ---------- */
type Cmd = { c: string; o: string };
export function Judges({ sc }: P) {
  const t = useT();
  const cmds = (sc.data.cmds as Cmd[] | undefined) ?? [];
  // the terminal types the commands and prints the real answers
  let out: { text: string; color: string }[] = [];
  let t0 = 1.0;
  for (const cmd of cmds) {
    const cd = Math.min(1.5, cmd.c.length * 0.012 + 0.4);
    if (t < t0) break;
    const n = Math.max(0, Math.min(cmd.c.length, Math.floor(((t - t0) / cd) * cmd.c.length)));
    out.push({ text: '$ ' + cmd.c.slice(0, n), color: PAPER });
    const os = t0 + cd + 0.3;
    if (t >= os) out.push({ text: cmd.o, color: PALE });
    else break;
    t0 = os + 0.7;
  }
  const panelIn = pr(t, 0.6, 0.6);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Chrome world="ink" t={t} />
      <Rise t={t} a={0.3} d={0.8} x={90} y={128} w={900} size={130} color={PAPER}>
        For <span style={{ color: ORANGE }}>judges.</span>
      </Rise>
      <Body t={t} a={0.9} x={1000} y={150} w={824} size={27} color={PAPER}>
        One shared judge key, in the Devpost testing instructions. It opens sandbox rooms over plain
        HTTP and nothing else. No key is needed for /try.
      </Body>
      {/* terminal */}
      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 300,
          width: 860,
          height: 600,
          border: `1.5px solid ${PAPER}`,
          opacity: pr(t, 0.6, 0.5),
        }}
      >
        <Mono x={24} y={18} size={15} color={DIM}>
          Judge API. Local run on the CI stack. Sandbox. Key in $KEY, tokens cut
        </Mono>
        <div
          style={{
            position: 'absolute',
            left: 24,
            top: 60,
            width: 812,
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: 21,
            lineHeight: '31px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {out.map((l, i) => (
            <div key={i} style={{ color: l.color, marginBottom: l.color === PALE ? 14 : 0 }}>
              {l.text.startsWith('$ ') ? (
                <>
                  <span style={{ color: ORANGE }}>$ </span>
                  {l.text.slice(2)}
                </>
              ) : (
                l.text
              )}
            </div>
          ))}
        </div>
      </div>
      {/* the paper panel with the recorded key field and the docs try-it page */}
      <div
        style={{
          position: 'absolute',
          left: 1000,
          top: 300,
          width: 824,
          height: 600,
          background: PAPER,
          overflow: 'hidden',
          opacity: panelIn,
          transform: `translateY(${((1 - panelIn) * 16).toFixed(1)}px)`,
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0 }}>
          {sc.panes.map((p) => (
            <Pane key={p.id} spec={p} t={t} />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: '100%',
            height: 54,
            background: PAPER,
            borderTop: `1.5px solid ${INK}`,
          }}
        >
          <Mono x={20} y={16} w={784} size={15} color={paper.mute} upper={false}>
            {t < (sc.ev.docsAt ?? 6.5)
              ? '/try: the key goes into a password field, so it shows as dots. Unlock, then rooms use the judge allowance.'
              : 'docs.gavel.dualmindlab.tech: Call the API as a judge, with a Try-it panel for every call.'}
          </Mono>
        </div>
      </div>
      <Rise
        t={t}
        a={8.8}
        d={0.7}
        x={96}
        y={930}
        w={1728}
        size={22}
        f="m"
        color={ORANGE}
        upper={false}
      >
        gavel.dualmindlab.tech/try · docs.gavel.dualmindlab.tech/docs/judges/call-the-api ·
        api.gavel.dualmindlab.tech
      </Rise>
    </AbsoluteFill>
  );
}

/* ---------- 16. what is still open ---------- */
const OPEN: [string, string][] = [
  [
    'G3 in progress',
    'The honor-period probe is still timing on the real sandbox. The final reading is about 12 Nov. No result is claimed.',
  ],
  [
    'G5 partial',
    'Speech is measured on synthetic, noise-free audio only, and every spoken bid is confirmed by the bidder.',
  ],
  [
    'Sandbox only',
    'No real money moves. A full multi-bidder settlement has not been run end to end on the PayPal sandbox.',
  ],
];
export function OpenItems(_p: P) {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Chrome world="ink" t={t} />
      <Rise t={t} a={0.2} d={0.8} x={96} y={140} w={1700} size={30} f="m" color={ORANGE}>
        What is still open
      </Rise>
      {OPEN.map((r, i) => {
        const y = 214 + i * 250;
        const a = 0.5 + i * 1.5;
        return (
          <div key={i}>
            <Rule t={t} a={a} d={0.7} x={96} y={y} w={1728} color={PAPER} />
            <Rise t={t} a={a + 0.1} d={0.8} x={96} y={y + 26} w={900} size={124} color={PAPER}>
              {r[0]}
            </Rise>
            <Body t={t} a={a + 0.3} x={1060} y={y + 34} w={764} size={30} color={PAPER}>
              {r[1]}
            </Body>
          </div>
        );
      })}
      <Rule t={t} a={5.0} d={0.5} x={96} y={214 + 3 * 250 - 6} w={1728} color={PAPER} />
    </AbsoluteFill>
  );
}

/* ---------- 17. outro ---------- */
const LINKS: [string, string][] = [
  ['Web app', 'gavel.dualmindlab.tech'],
  ['Docs', 'docs.gavel.dualmindlab.tech'],
  ['Source', 'github.com/harshbhx/gavel-auction'],
];
export function Outro({ letters }: P) {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Chrome world="ink" t={t} />
      <Lockup t={t} x={96} y={140} scale={1} letters={letters} ink={PAPER} />
      <Rise t={t} a={1.5} d={0.9} x={90} y={380} w={1750} size={118} color={PAPER}>
        Built by <span style={{ color: ORANGE }}>Harsh Bhanushali</span>
      </Rise>
      <Rise t={t} a={1.65} d={0.9} x={90} y={484} w={1750} size={118} color={PAPER}>
        and <span style={{ color: ORANGE }}>Dhairya Patel.</span>
      </Rise>
      {LINKS.map((l, i) => {
        const y = 640 + i * 92;
        return (
          <div key={i}>
            <Rule t={t} a={2.4 + i * 0.25} d={0.7} x={96} y={y} w={1728} color={PAPER} />
            <Rise t={t} a={2.5 + i * 0.25} x={96} y={y + 36} w={260} size={20} f="m" color={DIM}>
              {l[0]}
            </Rise>
            <Rise
              t={t}
              a={2.5 + i * 0.25}
              d={0.8}
              x={380}
              y={y + 14}
              w={1440}
              size={62}
              color={PAPER}
              upper={false}
            >
              {l[1]}
            </Rise>
          </div>
        );
      })}
      <Rule t={t} a={3.3} d={0.7} x={96} y={640 + 3 * 92} w={1728} color={PAPER} />
      <Mono x={96} y={936} w={1700} size={22} color={ORANGE} opacity={pr(t, 3.6, 0.6)}>
        PayPal sandbox only. G3 in progress, G5 partial: synthetic speech only.
      </Mono>
    </AbsoluteFill>
  );
}
