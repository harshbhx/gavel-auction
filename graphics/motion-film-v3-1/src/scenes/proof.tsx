import { Img, staticFile } from 'remotion';
import { cl, lerp, mix, pr, pulse, sp } from '../anim';
import { Lockup, Waves } from '../brand';
import { Eyebrow, Footer, LightSweep, Stage } from '../stage';
import {
  BODY,
  DIM,
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
} from '../theme';
import { Caps, Display, Mono, Roll, Rule } from '../type';
import { card, Chip } from '../ui';
import type { SceneCtx } from '../types';

/* 12. proof: four cards fly in from depth, counters roll, both latency misses in the same size. */
export function Proof({ t, frame, fps, dur }: SceneCtx) {
  // The narration walks the row: kill (2.3 s), webhooks (5.9 s), latency (8.8 s). The card it is on lights up.
  const lit = [
    { a: 2.3, b: 5.7 },
    { a: -1, b: -1 },
    { a: 5.9, b: 8.6 },
    { a: 8.8, b: 12.4 },
  ];
  const cards = [
    {
      eyebrow: 'KILL SURVIVED',
      big: [{ at: 1.2, v: 19 }],
      unit: 'ledger entries verify',
      sub: 'A real server kill during settlement on the PayPal sandbox: one capture, two voids.',
      fmt: (v: number) => String(Math.round(v)),
    },
    {
      eyebrow: 'LIVE VOICE',
      big: [{ at: 1.7, v: 24 }],
      unit: 'of 24 synthetic clips',
      sub: 'No bid accepted without a confirm. 5 confirm prompts, 0 accepted.',
      fmt: (v: number) => String(Math.round(v)),
    },
    {
      eyebrow: 'WEBHOOKS',
      big: [{ at: 2.2, v: 6 }],
      unit: 'of 6 real deliveries verified',
      sub: 'Capture and void events, signature verified at PayPal.',
      fmt: (v: number) => String(Math.round(v)),
    },
  ];
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={12}
      cam={[
        { at: 0, dur: 0, cam: { x: 36, s: 1.03, ry: 2.5 } },
        { at: 0, dur, cam: { x: -36, s: 1.0, ry: -2.5 } },
      ]}
      over={
        <>
          <Footer
            t={t}
            world="ink"
            text="Numbers and run ids from docs/GATES.md. G3 in progress, G5 partial."
          />
          <Eyebrow t={t} world="ink" text="09  Proof" />
        </>
      }
    >
      <div style={{ position: 'absolute', left: 120, top: 130, width: 1500 }}>
        <Display t={t} at={0.3} text="Measured, / **not promised.**" size={132} color={PAPER} />
      </div>
      {[...cards, null].map((c, i) => {
        const s = sp(t, 1.0 + i * 0.4, fps, { damping: 18, stiffness: 80 });
        const z = (1 - s) * -900;
        const on = pr(t, lit[i].a, 0.5) * (1 - pr(t, lit[i].b, 0.5));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 120 + i * 430,
              top: 470,
              width: 400,
              height: 500,
              transform: `translateZ(${(z + on * 60).toFixed(0)}px) translateY(${(-on * 14).toFixed(1)}px) rotateY(${((1 - s) * 20).toFixed(1)}deg)`,
              opacity: cl(s * 1.5),
              filter: `blur(${((1 - s) * 5).toFixed(1)}px)`,
            }}
          >
            <div
              style={{
                ...card('ink'),
                position: 'absolute',
                inset: 0,
                borderRadius: 12,
                padding: 28,
                borderColor:
                  on > 0.02 ? `rgba(255,106,31,${(0.25 + 0.75 * on).toFixed(2)})` : '#4a3b31',
                boxShadow: `0 30px 80px rgba(0,0,0,0.45), 0 0 ${(70 * on).toFixed(0)}px rgba(255,106,31,${(0.28 * on).toFixed(2)})`,
              }}
            >
              {c ? (
                <>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      letterSpacing: '0.16em',
                      color: ORANGE,
                    }}
                  >
                    {c.eyebrow}
                  </div>
                  <div style={{ color: PAPER, marginTop: 18 }}>
                    <Roll t={t} steps={c.big} fmt={c.fmt} size={170} first={1.0} />
                  </div>
                  <div style={{ fontFamily: BODY, fontSize: 22, color: PAPER, marginTop: 4 }}>
                    {c.unit}
                  </div>
                  <div
                    style={{
                      fontFamily: BODY,
                      fontSize: 17,
                      color: DIM,
                      marginTop: 16,
                      lineHeight: 1.5,
                    }}
                  >
                    {c.sub}
                  </div>
                  <div style={{ position: 'absolute', left: 28, bottom: 24 }}>
                    <Chip text="Passed" tone="orange" size={12} />
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      letterSpacing: '0.16em',
                      color: ORANGE,
                    }}
                  >
                    LATENCY, HONESTLY
                  </div>
                  {[
                    { k: 'hammer to captured p95', v: 3.8, target: '2.5 s' },
                    { k: 'hammer to settled p95', v: 6.9, target: '6 s' },
                  ].map((m, j) => (
                    <div key={m.k} style={{ marginTop: j === 0 ? 18 : 22 }}>
                      <div style={{ fontFamily: BODY, fontSize: 15, color: DIM }}>{m.k}</div>
                      <div
                        style={{ display: 'flex', alignItems: 'baseline', gap: 12, color: PAPER }}
                      >
                        <Roll
                          t={t}
                          steps={[{ at: 2.9 + j * 0.4, v: m.v }]}
                          fmt={(v) => `${v.toFixed(1)} s`}
                          size={84}
                          first={1.0}
                        />
                        <span style={{ fontFamily: MONO, fontSize: 15, color: DIM }}>
                          vs {m.target}
                        </span>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <Chip
                          text="Missed"
                          tone="hollow"
                          size={12}
                          style={{
                            color: ORANGE,
                            borderColor: ORANGE,
                            opacity: pr(t, 4.2 + j * 0.3, 0.3),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <div
                    style={{
                      fontFamily: BODY,
                      fontSize: 15,
                      color: DIM,
                      marginTop: 18,
                      lineHeight: 1.5,
                    }}
                  >
                    49 of 50 settlements on the sandbox. The targets are an open owner decision.
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </Stage>
  );
}

/* 13. speed: four score rings draw to 100, the mobile / desktop toggle flips and the rings redraw. */
export function Speed({ t, frame, fps, spec }: SceneCtx) {
  const labels = ['Performance', 'Accessibility', 'Best Practices', 'SEO'];
  const flipAt = 4.5;
  const flip = pr(t, flipAt, 0.6);
  const dip = Math.sin(Math.PI * cl((t - flipAt) / 0.9));
  return (
    <Stage
      t={t}
      frame={frame}
      world="paper"
      seed={13}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0, rx: 6 } },
        { at: 0, dur: 8, cam: { s: 1.05, rx: 0 } },
      ]}
      over={
        <>
          <Footer
            t={t}
            world="paper"
            text="PageSpeed Insights, Lighthouse 13.6.0, measured 10 Nov 2026. Mobile and desktop."
          />
          <Eyebrow t={t} world="paper" text="10  Speed" />
          <Caps t={t} caps={spec.caps} world="paper" x={96} y={120} size={116} width={1500} />
        </>
      }
    >
      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 440,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          opacity: pr(t, 0.6, 0.6),
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 260,
            height: 48,
            borderRadius: 24,
            border: `2px solid ${INK}`,
            background: PAPER_HI,
            overflow: 'hidden',
            fontFamily: MONO,
            fontSize: 15,
            letterSpacing: '0.1em',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 2,
              bottom: 2,
              left: 2 + flip * 128,
              width: 126,
              borderRadius: 20,
              background: INK,
            }}
          />
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: flip < 0.5 ? PAPER_HI : INK,
              }}
            >
              MOBILE
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: flip < 0.5 ? INK : PAPER_HI,
              }}
            >
              DESKTOP
            </div>
          </div>
        </div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 15,
            letterSpacing: '0.1em',
            color: MUTE,
            marginLeft: 8,
          }}
        >
          LANDING PAGE, LAB DATA
        </span>
      </div>
      {labels.map((l, i) => {
        const draw = pr(t, 1.0 + i * 0.25, 1.3) * (1 - 0.25 * dip);
        const r = 104;
        const C = 2 * Math.PI * r;
        const s = sp(t, 0.8 + i * 0.25, fps, { damping: 16, stiffness: 120 });
        return (
          <div
            key={l}
            style={{
              position: 'absolute',
              left: 300 + i * 380,
              top: 540,
              width: 260,
              textAlign: 'center',
              transform: `translateY(${((1 - s) * 60).toFixed(1)}px) rotateY(${(flip * 360).toFixed(0)}deg)`,
              opacity: cl(s * 2),
            }}
          >
            <svg
              width={260}
              height={260}
              style={{ display: 'block', margin: '0 auto', transform: 'rotate(-90deg)' }}
            >
              <circle
                cx={130}
                cy={130}
                r={r}
                fill={PAPER_HI}
                stroke={RULE_PAPER}
                strokeWidth={14}
              />
              <circle
                cx={130}
                cy={130}
                r={r}
                fill="none"
                stroke={ORANGE}
                strokeWidth={14}
                strokeDasharray={C}
                strokeDashoffset={C * (1 - draw)}
                strokeLinecap="round"
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 70,
                color: INK,
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <Roll
                t={t}
                steps={[{ at: 1.0 + i * 0.25, v: 100 }]}
                fmt={(v) => String(Math.round(v * (1 - 0.25 * dip)))}
                size={110}
                first={1.3}
              />
            </div>
            <div
              style={{ marginTop: 10, fontFamily: BODY, fontSize: 20, color: INK, fontWeight: 600 }}
            >
              {l}
            </div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 96, top: 880, display: 'flex', gap: 16 }}>
        {[
          { k: 'LCP', v: 1.1, f: (v: number) => `${v.toFixed(1)} s` },
          { k: 'TBT', v: 10, f: (v: number) => `${Math.round(v)} ms` },
          { k: 'CLS', v: 0, f: () => '0' },
        ].map((m, i) => {
          const s = sp(t, 5.2 + i * 0.15, fps, { damping: 14, stiffness: 180 });
          if (s <= 0) return null;
          return (
            <div
              key={m.k}
              style={{
                ...card('paper'),
                padding: '12px 22px',
                display: 'flex',
                alignItems: 'baseline',
                gap: 14,
                transform: `translateY(${((1 - s) * 30).toFixed(1)}px)`,
                opacity: cl(s * 2),
              }}
            >
              <span
                style={{ fontFamily: MONO, fontSize: 14, letterSpacing: '0.14em', color: MUTE }}
              >
                {m.k}
              </span>
              <div style={{ color: INK }}>
                <Roll
                  t={t}
                  steps={[{ at: 5.3 + i * 0.15, v: m.v }]}
                  fmt={m.f}
                  size={44}
                  first={0.8}
                />
              </div>
              <span style={{ fontFamily: MONO, fontSize: 13, color: MUTE }}>mobile</span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

/* 14. judges: the key field fills with dots, Unlock, accepted; the terminal types the calls. */
export function Judges({ t, frame, fps, spec }: SceneCtx) {
  const dots = Math.floor(cl((t - 1.0) / 1.4) * 24);
  const unlock = sp(t, 3.2, fps, { damping: 13, stiffness: 220 });
  const lines = [
    {
      at: 4.2,
      s: '$ curl -s -X POST $API/api/judge/rooms -H "x-judge-key: $KEY" -d \'{"title":"My lot"}\'',
      c: PAPER,
    },
    {
      at: 5.5,
      s: '{ "auctionId": "a9f3c1\u2026", "joinCode": "7K2P", "auctioneerToken": "t_4b\u2026" }',
      c: ORANGE,
    },
    {
      at: 6.6,
      s: '$ curl -s $API/api/judge/rooms/$ID/ledger -H "authorization: Bearer $REVIEWER"',
      c: PAPER,
    },
    { at: 7.8, s: '{ "count": 9, "headHash": "5e1c\u2026" }', c: ORANGE },
  ];
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={14}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0, ry: -3 } },
        { at: 0, dur: 10, cam: { s: 1.04, ry: 1 } },
      ]}
      over={
        <>
          <Footer
            t={t}
            world="ink"
            text="The shared judge key lives only in the Devpost testing instructions. Never in the repository or this film."
          />
          <Eyebrow t={t} world="ink" text="11  For judges" />
          <Caps t={t} caps={spec.caps} world="ink" x={96} y={260} size={104} width={820} />
          <div style={{ position: 'absolute', left: 96, top: 740, width: 860 }}>
            <Mono
              t={t}
              at={7.0}
              text="Try page      open, no key"
              size={24}
              color={PAPER}
              dur={0.6}
              style={{ lineHeight: 1.9 }}
            />
            <Mono
              t={t}
              at={7.5}
              text="Judge API     the shared key, sent as a header"
              size={24}
              color={PAPER}
              dur={0.8}
              style={{ lineHeight: 1.9 }}
            />
            <Mono
              t={t}
              at={8.1}
              text="Docs          a step-by-step guide for judges"
              size={24}
              color={PAPER}
              dur={0.7}
              style={{ lineHeight: 1.9 }}
            />
          </div>
        </>
      }
    >
      <div
        style={{
          position: 'absolute',
          left: 1000,
          top: 130,
          width: 820,
          transform: `rotateY(${(-12 * (1 - pr(t, 0.2, 1.2))).toFixed(2)}deg)`,
          opacity: pr(t, 0.2, 0.8),
        }}
      >
        <div style={{ ...card('paper'), padding: 30, position: 'relative', overflow: 'hidden' }}>
          <LightSweep t={t} at={3.4} alpha={0.6} color="#ffffff" />
          <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '0.14em', color: MUTE }}>
            JUDGE PANEL, TRY PAGE
          </div>
          <div
            style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, color: INK, marginTop: 6 }}
          >
            Judge key
          </div>
          <div style={{ fontSize: 15, color: MUTE, marginTop: 4 }}>
            From the slide deck. It stays in this tab and is never put in a link.
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
            <div
              style={{
                flex: 1,
                height: 58,
                border: `2px solid ${INK}`,
                borderRadius: 6,
                background: PAPER_HI,
                display: 'flex',
                alignItems: 'center',
                padding: '0 16px',
                fontFamily: MONO,
                fontSize: 22,
                letterSpacing: '0.2em',
                color: INK,
              }}
            >
              {'\u2022'.repeat(dots)}
              {t > 1.0 && t < 2.4 ? <span style={{ color: ORANGE }}>|</span> : null}
            </div>
            <div
              style={{
                width: 150,
                height: 58,
                borderRadius: 6,
                background: unlock > 0.5 ? INK : ORANGE,
                border: `2px solid ${INK}`,
                color: unlock > 0.5 ? PAPER_HI : '#1a0a00',
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: `scale(${(1 - 0.08 * Math.sin(Math.PI * cl((t - 3.0) / 0.3))).toFixed(3)})`,
                boxShadow: `3px 3px 0 ${INK}`,
              }}
            >
              {unlock > 0.5 ? 'Checking' : 'Unlock'}
            </div>
          </div>
          <div style={{ marginTop: 16, minHeight: 36 }}>
            {unlock > 0 ? (
              <div
                style={{
                  transform: `translateY(${((1 - unlock) * 20).toFixed(1)}px)`,
                  opacity: cl(unlock * 2),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <Chip text="Judge key accepted" tone="orange" size={13} />
                <span style={{ fontSize: 14, color: MUTE }}>
                  Rooms you start use the judge allowance.
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div
          style={{
            ...card('ink'),
            marginTop: 22,
            padding: '22px 26px',
            borderRadius: 10,
            minHeight: 300,
            background: INK_DEEP,
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: i === 0 ? ORANGE : '#4a3b31',
                }}
              />
            ))}
            <span
              style={{
                fontFamily: MONO,
                fontSize: 12,
                color: DIM,
                marginLeft: 10,
                letterSpacing: '0.12em',
              }}
            >
              TERMINAL. KEY IN $KEY, NEVER PRINTED
            </span>
          </div>
          {lines.map((l) => (
            <Mono
              key={l.at}
              t={t}
              at={l.at}
              text={l.s}
              size={16}
              color={l.c}
              dur={0.9}
              style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}
            />
          ))}
        </div>
      </div>
    </Stage>
  );
}

/* 15. built with: PayPal and Render as plates (type by default, the official PayPal mark only when
   sponsorLogos is on), the other tools in a mono row. */
export function BuiltWith({ t, frame, fps, sponsorLogos }: SceneCtx) {
  // Each plate lands just before its narration line (voiceover.mjs): PayPal, Render, APIMatic, AG Grid.
  const plates = [
    {
      name: 'PayPal',
      line: 'Payments in the PayPal sandbox.',
      sub: 'Orders v2 AUTHORIZE, Payments v2 capture and void, webhooks. Built for the PayPal AI Hackathon 2026.',
      at: 0.9,
      logo: true,
    },
    {
      name: 'Render',
      line: 'API hosted on Render.',
      sub: 'The GAVEL server, its sandbox rooms and the judge API.',
      at: 3.3,
      logo: false,
    },
    {
      name: 'APIMatic',
      line: 'Typed SDKs, generated with APIMatic.',
      sub: 'TypeScript, Python and C# clients built from the OpenAPI 3.1 spec of the host API. Beta, sandbox only.',
      at: 5.6,
      logo: false,
    },
    {
      name: 'AG Grid',
      line: 'Live bid and audit tables.',
      sub: 'AG Grid Community: sortable, filterable bid and ledger tables, with the hash-chain check run in the browser.',
      at: 8.9,
      logo: false,
    },
  ];
  const PW = 410;
  return (
    <Stage
      t={t}
      frame={frame}
      world="paper"
      seed={15}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0 } },
        { at: 0, dur: 13, cam: { s: 1.04, ry: -1.5 } },
      ]}
      over={
        <>
          <Footer
            t={t}
            world="paper"
            text="Names only, no endorsement implied. Also Cloudflare Workers, Deepgram and Groq."
          />
          <Eyebrow t={t} world="paper" text="13  Built with" />
        </>
      }
    >
      <div style={{ position: 'absolute', left: 96, top: 100 }}>
        <Display t={t} at={0.3} text="Built **with.**" size={170} color={INK} />
      </div>
      {plates.map((p, i) => {
        const s = sp(t, p.at, fps, { damping: 18, stiffness: 90 });
        return (
          <div
            key={p.name}
            style={{
              position: 'absolute',
              left: 90 + i * (PW + 20),
              top: 390,
              width: PW,
              height: 420,
              transform: `rotateY(${((i < 2 ? 14 : -14) * (1 - s)).toFixed(1)}deg) translateY(${((1 - s) * 60).toFixed(1)}px)`,
              opacity: cl(s * 2),
            }}
          >
            <div
              style={{
                ...card('paper'),
                position: 'absolute',
                inset: 0,
                padding: 32,
                overflow: 'hidden',
              }}
            >
              <LightSweep t={t} at={p.at + 1.0} alpha={0.6} color="#ffffff" />
              <div style={{ height: 100, display: 'flex', alignItems: 'center' }}>
                {p.logo && sponsorLogos ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      opacity: pr(t, p.at + 0.3, 0.8),
                    }}
                  >
                    <Img src={staticFile('partners/paypal-mark.svg')} style={{ height: 72 }} />
                    <Img src={staticFile('partners/paypal-wordmark.svg')} style={{ height: 42 }} />
                  </div>
                ) : (
                  <div
                    style={{
                      fontFamily: DISPLAY,
                      fontWeight: 900,
                      fontSize: 84,
                      color: INK,
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                      letterSpacing: `${lerp(0.06, 0, pr(t, p.at, 0.9)).toFixed(3)}em`,
                    }}
                  >
                    {p.name}
                  </div>
                )}
              </div>
              <div
                style={{
                  fontFamily: BODY,
                  fontSize: 28,
                  color: INK,
                  marginTop: 20,
                  fontWeight: 600,
                  lineHeight: 1.2,
                }}
              >
                {p.line}
              </div>
              <div
                style={{
                  fontFamily: BODY,
                  fontSize: 21,
                  color: MUTE,
                  marginTop: 12,
                  lineHeight: 1.5,
                }}
              >
                {p.sub}
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 90, top: 900, display: 'flex', gap: 14 }}>
        {['Cloudflare Workers', 'Deepgram', 'Groq', 'Remotion', 'React', 'TypeScript'].map(
          (n, i) => {
            const s = sp(t, 10.4 + i * 0.1, fps, { damping: 15, stiffness: 180 });
            if (s <= 0) return null;
            return (
              <div
                key={n}
                style={{
                  transform: `translateY(${((1 - s) * 24).toFixed(1)}px)`,
                  opacity: cl(s * 2),
                }}
              >
                <Chip text={n} tone="paper" size={18} />
              </div>
            );
          },
        )}
      </div>
    </Stage>
  );
}

/* 16. open: what is still open, three rows with pulsing chips. */
export function Open({ t, frame, dur }: SceneCtx) {
  const rows = [
    {
      chip: 'In progress',
      text: 'G3 honor period. Real probe running; final reading about 12 Nov.',
      at: 1.5,
    },
    {
      chip: 'Partial',
      text: 'G5 speech accuracy. Synthetic clips only; a confirm step on every voice bid.',
      at: 3.6,
    },
    { chip: 'Sandbox only', text: 'No real money moves anywhere in this build.', at: 5.8 },
  ];
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={16}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0 } },
        { at: 0, dur, cam: { s: 1.05 } },
      ]}
      over={<Eyebrow t={t} world="ink" text="13  Open items" />}
    >
      <div style={{ position: 'absolute', left: 96, top: 110 }}>
        <Display t={t} at={0.3} text="Still **open.**" size={180} color={PAPER} />
      </div>
      {rows.map((r, i) => {
        const p = pr(t, r.at, 0.8);
        return (
          <div
            key={r.chip}
            style={{
              position: 'absolute',
              left: 96,
              top: 470 + i * 160,
              width: 1700,
              opacity: p,
              transform: `translateY(${((1 - p) * 30).toFixed(1)}px)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <div style={{ width: 250 }}>
                <Chip
                  text={r.chip}
                  tone="hollow"
                  size={18}
                  style={{
                    color: ORANGE,
                    borderColor: ORANGE,
                    opacity: 0.75 + 0.25 * pulse(t, r.at, 1.0),
                  }}
                />
              </div>
              <div style={{ fontFamily: BODY, fontSize: 38, color: PAPER }}>{r.text}</div>
            </div>
            <Rule t={t} at={r.at + 0.2} x={0} y={70} w={1700} color="#4a3b31" dur={1.0} />
          </div>
        );
      })}
    </Stage>
  );
}

/* 17. outro: the lockup strikes, names rise, links draw, rings keep breathing to the last frame. */
export function Outro({ t, frame, letters }: SceneCtx) {
  const strike = 0.3 + 0.72 * 0.8;
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={17}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0 } },
        { at: 0, dur: 10.5, cam: { s: 1.03, ry: 1 } },
      ]}
    >
      <Waves
        t={t}
        strikes={[strike, strike + 2.5, strike + 5, strike + 7.5]}
        x={960}
        y={300}
        size={240}
        n={2}
        dur={2.2}
        max={7}
        alpha={0.28}
      />
      <Lockup
        t={t}
        x={547}
        y={160}
        scale={1.2}
        letters={letters}
        ink={PAPER}
        timing={{ swingStart: 0.3, swingDur: 0.8 }}
        lettersAt={1.0}
      />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 480, textAlign: 'center' }}>
        <Display
          t={t}
          at={2.0}
          text="Built by **Harsh Bhanushali** / and **Dhairya Patel.**"
          size={96}
          color={PAPER}
          align="center"
        />
      </div>
      <Rule t={t} at={5.3} x={760} y={738} w={400} color={ORANGE} dur={0.9} thick={2} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 772, textAlign: 'center' }}>
        <Display
          t={t}
          at={5.5}
          text="Every bid is a **hold.** The hammer is the payment."
          size={60}
          color={PAPER}
          align="center"
          weight={600}
        />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 890, textAlign: 'center' }}>
        <Mono
          t={t}
          at={7.4}
          text="Live demo, docs and source code: links in the description."
          size={22}
          color={DIM}
          dur={1.2}
          style={{ display: 'inline-block' }}
        />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 940, textAlign: 'center' }}>
        <Mono
          t={t}
          at={8.4}
          text="PayPal sandbox only. No real money moves."
          size={20}
          color={DIM}
          dur={1.0}
          style={{ display: 'inline-block' }}
        />
      </div>
    </Stage>
  );
}

export const proofUtil = { mix, ORANGE_DEEP, MUTE, RULE_PAPER };
