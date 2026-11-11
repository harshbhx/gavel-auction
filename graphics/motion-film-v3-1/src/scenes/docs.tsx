import { cl, pr, pulse, sp } from '../anim';
import { Eyebrow, Footer, LightSweep, Stage } from '../stage';
import {
  BODY,
  DISPLAY,
  INK,
  INK_DEEP,
  MONO,
  MUTE,
  ORANGE,
  ORANGE_DEEP,
  PAPER,
  PAPER_HI,
  PAPER_LO,
  RULE_PAPER,
} from '../theme';
import { Display, Mono } from '../type';
import type { SceneCtx } from '../types';

/* 14. docs: the documentation site, the way a reader sees it. Real page titles and text from the docs site
   (docsite/content/docs), real routes from openapi/gavel.yaml, and the typed SDK call. No address bar, no URLs.
   Three beats follow the narration: the guides, the API reference, the typed SDKs. */

const GUIDES = 0.6;
const REFERENCE = 6.5;
const SDK = 9.0;

const WIN = { left: 180, top: 130, w: 1560, h: 730 };

const ROOTS = ['Learn', 'For judges', 'Reference'];
const SIDEBAR_GUIDES = [
  'Bid lifecycle',
  'Auction states and soft close',
  'Registration and holds',
  'Money flow',
  'Settlement saga',
  'Idempotency and request ids',
];
const SIDEBAR_REF = [
  'API reference',
  'WebSocket protocol',
  'Events',
  'Saga states',
  'Data model',
  'Configuration',
];

const IDEAS = [
  [
    'The journal comes first.',
    'Every transition is one compare-and-set save before the next effect.',
  ],
  [
    'An unknown answer is not a failure.',
    'A capture that times out stays in CAPTURING; it never moves on.',
  ],
  [
    'Only a definite refusal falls back.',
    'The saga reads the truth first, then moves to the next candidate.',
  ],
];

const ROUTES: { m: string; p: string; s: string; hot?: boolean }[] = [
  { m: 'POST', p: '/api/auctions', s: 'Create an auction' },
  { m: 'POST', p: '/api/holds/{holdId}/approve', s: 'Approve a hold' },
  { m: 'POST', p: '/api/judge/rooms', s: 'Open a judge room' },
  { m: 'POST', p: '/api/judge/rooms/{id}/bids', s: 'Place a bid over HTTP', hot: true },
  { m: 'GET', p: '/api/judge/rooms/{id}/ledger', s: 'Read the room ledger' },
  { m: 'GET', p: '/api/auctions/{id}/receipt', s: 'Read a receipt' },
];

const SDK_LINES = [
  'import { GavelHostApiClient }',
  '  from "gavel-sdk";',
  '',
  'const client = new GavelHostApiClient({',
  '  sessionAuth: "YOUR_BEARER_TOKEN",',
  '});',
  '',
  'const res = await client.judgeRooms',
  '  .placeJudgeBid({',
  '    id: roomId,',
  '    body: { amount: 35000 },',
  '  });',
];

function Tab({ text, on }: { text: string; on: boolean }) {
  return (
    <div
      style={{
        fontFamily: BODY,
        fontWeight: 700,
        fontSize: 20,
        padding: '10px 18px',
        borderRadius: 6,
        color: on ? INK : MUTE,
        background: on ? PAPER_LO : 'transparent',
        border: on ? `2px solid ${INK}` : '2px solid transparent',
      }}
    >
      {text}
    </div>
  );
}

export function Docs({ t, frame, fps }: SceneCtx) {
  const rise = sp(t, 0.15, fps, { damping: 18, stiffness: 90 });
  const onRef = t >= REFERENCE;
  const onSdk = t >= SDK;
  const swap = pr(t, REFERENCE, 0.5);
  const sdkIn = pr(t, SDK, 0.6);
  const guidesOut = 1 - swap;
  return (
    <Stage
      t={t}
      frame={frame}
      world="ink"
      seed={14}
      cam={[
        { at: 0, dur: 0, cam: { s: 1.0, ry: 3 } },
        { at: 0, dur: 13.5, cam: { s: 1.05, ry: -2 } },
      ]}
      over={
        <>
          <Footer
            t={t}
            world="ink"
            text="Written from the code. Typed SDKs generated with APIMatic. Sandbox only."
          />
          <Eyebrow t={t} world="ink" text="12  Docs" />
        </>
      }
    >
      <div
        style={{
          position: 'absolute',
          left: WIN.left,
          top: WIN.top,
          width: WIN.w,
          height: WIN.h,
          transform: `translateY(${((1 - rise) * 90).toFixed(1)}px) rotateX(${((1 - rise) * 10).toFixed(2)}deg)`,
          opacity: cl(rise * 2),
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: PAPER_HI,
            border: `2px solid ${INK}`,
            borderRadius: 10,
            boxShadow: `0 40px 120px rgba(0,0,0,0.55), 0 0 ${18 * pulse(t, SDK, 3)}px ${ORANGE}`,
            overflow: 'hidden',
          }}
        >
          <LightSweep t={t} at={0.9} alpha={0.5} color="#ffffff" />
          {/* top bar: the wordmark text, the three root tabs, the search box */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: 76,
              borderBottom: `2px solid ${INK}`,
              display: 'flex',
              alignItems: 'center',
              padding: '0 28px',
              gap: 26,
              background: PAPER,
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 900,
                fontSize: 38,
                letterSpacing: '0.04em',
                color: INK,
              }}
            >
              GAVEL <span style={{ color: ORANGE }}>docs</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {ROOTS.map((r, i) => (
                <Tab key={r} text={r} on={onRef ? i === 2 : i === 0} />
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                fontFamily: MONO,
                fontSize: 16,
                color: MUTE,
                border: `2px solid ${RULE_PAPER}`,
                borderRadius: 6,
                padding: '8px 16px',
                width: 280,
                background: PAPER_HI,
              }}
            >
              Search docs
            </div>
          </div>
          {/* sidebar */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 76,
              bottom: 0,
              width: 360,
              borderRight: `2px solid ${RULE_PAPER}`,
              padding: '26px 22px',
              background: PAPER,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 14,
                letterSpacing: '0.14em',
                color: MUTE,
                marginBottom: 14,
              }}
            >
              {onRef ? 'REFERENCE' : 'HOW IT WORKS'}
            </div>
            {(onRef ? SIDEBAR_REF : SIDEBAR_GUIDES).map((s, i) => {
              const on = onRef ? i === 0 : s === 'Settlement saga';
              const lit = on ? pr(t, onRef ? REFERENCE + 0.2 : GUIDES + 1.6, 0.4) : 0;
              return (
                <div
                  key={s}
                  style={{
                    fontFamily: BODY,
                    fontWeight: on ? 800 : 500,
                    fontSize: 21,
                    padding: '10px 14px',
                    marginBottom: 6,
                    borderRadius: 6,
                    color: INK,
                    background: on ? `rgba(255,106,31,${(0.22 * lit).toFixed(3)})` : 'transparent',
                    borderLeft: `5px solid ${on ? ORANGE : 'transparent'}`,
                  }}
                >
                  {s}
                </div>
              );
            })}
          </div>
          {/* page: guides */}
          <div
            style={{
              position: 'absolute',
              left: 360,
              top: 76,
              right: 0,
              bottom: 0,
              padding: '44px 64px',
              opacity: guidesOut,
              transform: `translateX(${(-60 * swap).toFixed(1)}px)`,
              display: guidesOut <= 0.001 ? 'none' : 'block',
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 15,
                letterSpacing: '0.12em',
                color: ORANGE_DEEP,
              }}
            >
              LEARN / HOW IT WORKS
            </div>
            <div style={{ marginTop: 10 }}>
              <Display t={t} at={GUIDES + 0.5} text="Settlement saga" size={96} color={INK} />
            </div>
            <div style={{ fontFamily: BODY, fontSize: 26, color: MUTE, marginTop: 6 }}>
              The state machine, the journal and idempotency.
            </div>
            <div
              style={{
                marginTop: 34,
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 40,
                color: INK,
              }}
            >
              Three ideas
            </div>
            {IDEAS.map(([h, b], i) => {
              const s = sp(t, GUIDES + 2.6 + i * 0.9, fps, { damping: 16, stiffness: 110 });
              return (
                <div
                  key={h}
                  style={{
                    display: 'flex',
                    gap: 18,
                    marginTop: 18,
                    opacity: cl(s * 2),
                    transform: `translateY(${((1 - s) * 30).toFixed(1)}px)`,
                  }}
                >
                  <div
                    style={{
                      fontFamily: DISPLAY,
                      fontWeight: 900,
                      fontSize: 46,
                      color: ORANGE,
                      width: 44,
                      lineHeight: 1,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 27, color: INK }}>
                      {h}
                    </div>
                    <div style={{ fontFamily: BODY, fontSize: 22, color: MUTE, marginTop: 2 }}>
                      {b}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* page: API reference, with the typed SDK call on the right once it lands */}
          <div
            style={{
              position: 'absolute',
              left: 360,
              top: 76,
              right: 0,
              bottom: 0,
              padding: '44px 56px',
              opacity: swap,
              transform: `translateX(${((1 - swap) * 70).toFixed(1)}px)`,
              display: swap <= 0.001 ? 'none' : 'block',
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 15,
                letterSpacing: '0.12em',
                color: ORANGE_DEEP,
              }}
            >
              REFERENCE
            </div>
            <div style={{ marginTop: 10 }}>
              <Display t={t} at={REFERENCE + 0.3} text="API reference" size={88} color={INK} />
            </div>
            <div
              style={{ fontFamily: BODY, fontSize: 22, color: MUTE, marginTop: 6, maxWidth: 560 }}
            >
              The HTTP API of the host as an OpenAPI 3.1 document, with authentication, errors and
              rate limits.
            </div>
            <div style={{ marginTop: 26, width: onSdk ? 500 : 1100 }}>
              {ROUTES.map((r, i) => {
                const s = sp(t, REFERENCE + 0.8 + i * 0.18, fps, { damping: 16, stiffness: 140 });
                const hot = Boolean(r.hot) && t > REFERENCE + 1.8;
                return (
                  <div
                    key={r.p}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '11px 14px',
                      marginBottom: 8,
                      borderRadius: 6,
                      border: `2px solid ${hot ? INK : RULE_PAPER}`,
                      background: hot ? 'rgba(255,106,31,0.2)' : PAPER,
                      opacity: cl(s * 2),
                      transform: `translateX(${((1 - s) * 50).toFixed(1)}px)`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: MONO,
                        fontWeight: 800,
                        fontSize: 15,
                        padding: '4px 10px',
                        borderRadius: 4,
                        color: r.m === 'POST' ? '#1a0a00' : PAPER,
                        background: r.m === 'POST' ? ORANGE : INK,
                        width: 64,
                        textAlign: 'center',
                      }}
                    >
                      {r.m}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 19, color: INK, fontWeight: 700 }}>
                      {r.p}
                    </div>
                    <div style={{ flex: 1 }} />
                    {onSdk ? null : (
                      <div style={{ fontFamily: BODY, fontSize: 18, color: MUTE }}>{r.s}</div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* the typed SDK panel */}
            <div
              style={{
                position: 'absolute',
                right: 40,
                top: 150,
                width: 600,
                height: 500,
                background: INK_DEEP,
                border: `2px solid ${INK}`,
                borderRadius: 8,
                boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
                padding: '20px 26px',
                opacity: sdkIn,
                transform: `translateX(${((1 - sdkIn) * 120).toFixed(1)}px) rotateY(${((1 - sdkIn) * -14).toFixed(1)}deg)`,
                display: sdkIn <= 0.001 ? 'none' : 'block',
              }}
            >
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {['TypeScript', 'Python', 'C#'].map((l, i) => (
                  <div
                    key={l}
                    style={{
                      fontFamily: MONO,
                      fontSize: 16,
                      fontWeight: 700,
                      padding: '6px 14px',
                      borderRadius: 4,
                      color: i === 0 ? '#1a0a00' : PAPER_LO,
                      background: i === 0 ? ORANGE : 'transparent',
                      border: `2px solid ${i === 0 ? ORANGE : '#4a3b31'}`,
                    }}
                  >
                    {l}
                  </div>
                ))}
              </div>
              {SDK_LINES.map((l, i) => (
                <Mono
                  key={i}
                  t={t}
                  at={SDK + 0.5 + i * 0.28}
                  text={l === '' ? ' ' : l}
                  size={19}
                  color={i < 6 ? PAPER : '#f5b488'}
                  dur={0.35}
                  style={{ lineHeight: 1.55 }}
                />
              ))}
              <div
                style={{
                  position: 'absolute',
                  left: 26,
                  right: 26,
                  bottom: 22,
                  fontFamily: MONO,
                  fontSize: 15,
                  color: PAPER_LO,
                  opacity: pr(t, SDK + 3.4, 0.5),
                  lineHeight: 1.5,
                }}
              >
                Generated by APIMatic from the OpenAPI spec.
                <br />
                Typed request, typed response, typed errors.
              </div>
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}
