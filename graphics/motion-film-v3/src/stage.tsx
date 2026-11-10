import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { CAM, camAt, camCss, cl, lerp, pr, type CamKey } from './anim';
import { colors, H, INK, INK_DEEP, MONO, ORANGE, PAPER, PAPER_HI, W, type World } from './theme';

/* The stage: a gradient ground, drifting glow fields (far layer), a perspective world the camera moves,
   moving grain, and the mono footer. Every scene sits on one of these, so every frame has at least the
   glow drift and the grain moving even while a type line holds. */

const NOISE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>\")";

export function Grain({ frame, world }: { frame: number; world: World }) {
  const ox = (frame * 37) % 220;
  const oy = (frame * 53) % 220;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: NOISE,
        backgroundSize: '220px 220px',
        backgroundPosition: `${ox}px ${oy}px`,
        opacity: world === 'ink' ? 0.16 : 0.12,
        mixBlendMode: 'soft-light',
        pointerEvents: 'none',
      }}
    />
  );
}

/** Three soft glow blobs drifting slowly; the far parallax layer. */
export function GlowField({ t, world, seed = 0 }: { t: number; world: World; seed?: number }) {
  const ink = world === 'ink';
  const blobs = [
    { c: ink ? ORANGE : ORANGE, a: ink ? 0.22 : 0.16, x: 0.22, y: 0.28, r: 620, f: 0.11 },
    { c: ink ? PAPER : PAPER_HI, a: ink ? 0.1 : 0.9, x: 0.78, y: 0.72, r: 760, f: 0.08 },
    { c: ink ? ORANGE : '#f5b488', a: ink ? 0.12 : 0.22, x: 0.62, y: 0.12, r: 460, f: 0.14 },
  ];
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {blobs.map((b, i) => {
        const ph = seed * 1.7 + i * 2.1;
        const dx = Math.sin(t * b.f * 2 * Math.PI + ph) * 90;
        const dy = Math.cos(t * b.f * 1.6 * Math.PI + ph) * 60;
        const k = 1 + 0.06 * Math.sin(t * 0.9 + ph);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: b.x * W - b.r + dx,
              top: b.y * H - b.r + dy,
              width: b.r * 2,
              height: b.r * 2,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${b.c} 0%, ${b.c}00 62%)`,
              opacity: b.a,
              transform: `scale(${k.toFixed(3)})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

/** A 40 degree light band that crosses a region once, from `at` over `dur`. */
export function LightSweep({
  t,
  at,
  dur = 1.4,
  alpha = 0.16,
  color = PAPER,
  style,
}: {
  t: number;
  at: number;
  dur?: number;
  alpha?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const p = pr(t, at, dur, CAM);
  if (p <= 0 || p >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        borderRadius: 'inherit',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '-60%',
          left: `${lerp(-70, 150, p)}%`,
          width: '38%',
          height: '220%',
          transform: 'rotate(28deg)',
          background: `linear-gradient(90deg, ${color}00 0%, ${color} 50%, ${color}00 100%)`,
          opacity: alpha * Math.sin(Math.PI * p),
        }}
      />
    </div>
  );
}

/** The mono footer and the eyebrow of a product scene. */
export function Footer({
  t,
  world,
  text = 'Motion graphics of the app. Sandbox only. No real money moves.',
  right = 'GAVEL',
}: {
  t: number;
  world: World;
  text?: string;
  right?: string;
}) {
  const c = colors(world);
  const o = pr(t, 0.2, 0.6);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 72,
          bottom: 44,
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: '0.04em',
          color: c.mute,
          opacity: o,
          transform: `translateY(${(1 - o) * 12}px)`,
        }}
      >
        {text}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 72,
          bottom: 44,
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: '0.18em',
          color: c.mute,
          opacity: o,
        }}
      >
        {right}
      </div>
    </>
  );
}

export function Eyebrow({
  t,
  world,
  text,
  at = 0.1,
  x = 72,
  y = 56,
}: {
  t: number;
  world: World;
  text: string;
  at?: number;
  x?: number;
  y?: number;
}) {
  const c = colors(world);
  const p = pr(t, at, 0.7);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        fontFamily: MONO,
        fontSize: 20,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: c.mute,
        opacity: p,
        clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`,
      }}
    >
      <span style={{ color: ORANGE }}>/ </span>
      {text}
    </div>
  );
}

/** Soft vignette; `k` tightens it (0 none, 1 strong). */
export function Vignette({ k, world }: { k: number; world: World }) {
  const c = world === 'ink' ? INK_DEEP : '#c9b995';
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, ${c}00 ${lerp(70, 35, cl(k))}%, ${c} 140%)`,
        opacity: lerp(0.35, 0.8, cl(k)),
        pointerEvents: 'none',
      }}
    />
  );
}

export function Stage({
  t,
  frame,
  world,
  cam = [],
  children,
  over,
  seed = 0,
  vignette = 0,
}: {
  t: number;
  frame: number;
  world: World;
  cam?: CamKey[];
  children: ReactNode;
  /** Layers outside the camera (footer, captions, flashes). */
  over?: ReactNode;
  seed?: number;
  vignette?: number;
}) {
  const c = camAt(t, cam.length ? cam : [{ at: 0, dur: 0, cam: {} }]);
  const bg =
    world === 'ink'
      ? `linear-gradient(160deg, ${INK} 0%, ${INK_DEEP} 100%)`
      : `linear-gradient(160deg, ${PAPER_HI} 0%, ${PAPER} 55%, #e9dec6 100%)`;
  return (
    <AbsoluteFill style={{ background: bg, overflow: 'hidden' }}>
      <GlowField t={t} world={world} seed={seed} />
      <div style={{ position: 'absolute', inset: 0, perspective: 1800, perspectiveOrigin: '50% 50%' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transformStyle: 'preserve-3d',
            transform: camCss(c),
            transformOrigin: '50% 50%',
          }}
        >
          {children}
        </div>
      </div>
      <Vignette k={vignette} world={world} />
      <Grain frame={frame} world={world} />
      {over}
    </AbsoluteFill>
  );
}
