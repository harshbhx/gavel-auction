import type { ReactNode } from 'react';
import { Img, staticFile } from 'remotion';
import { CAM, cl, lerp, pr } from './anim';
import { INK, MONO, MUTE, ORANGE, PAPER, W, H } from './theme';
import type { Box, CamKey, PaneSpec } from './types';
import { Mono } from './ui';

/** Index of the last frame at or before the recording time (frames sorted by timestamp). */
function frameAt(frames: [number, string][], rec: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  if (hi < 0) return -1;
  if (rec <= frames[0][0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid][0] <= rec) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A recorded pane: the actor's JPEG frame for this instant, in its device frame or on a plate. */
export function Pane({ spec, t }: { spec: PaneSpec; t: number }) {
  if (t < spec.from - 1e-6 || t > spec.to + 1e-6) return null;
  const rec = spec.startAbs + (t - spec.from) * spec.speed;
  const i = frameAt(spec.frames, rec);
  const src = i >= 0 ? staticFile(spec.frames[i][1]) : null;
  const picture = src ? (
    <Img src={src} style={{ display: 'block', width: spec.w, height: spec.h, objectFit: 'fill' }} />
  ) : (
    <div
      style={{
        width: spec.w,
        height: spec.h,
        background: PAPER,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: MONO,
        fontSize: 16,
        color: MUTE,
        textTransform: 'uppercase',
        letterSpacing: '.08em',
      }}
    >
      recording unavailable
    </div>
  );
  if (spec.kind === 'phone') {
    const r = Math.round(spec.w * 0.115);
    return (
      <>
        <div
          style={{
            position: 'absolute',
            left: spec.x - 12,
            top: spec.y - 12,
            width: spec.w + 24,
            height: spec.h + 24,
            borderRadius: r + 12,
            border: `3px solid ${INK}`,
            background: INK,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 9,
              top: 9,
              width: spec.w,
              height: spec.h,
              borderRadius: r,
              overflow: 'hidden',
              background: PAPER,
            }}
          >
            {picture}
          </div>
        </div>
        {spec.label ? (
          <Mono
            x={spec.x - 12}
            y={spec.y + spec.h + 26}
            w={Math.max(spec.w + 200, 300)}
            size={16}
            color={MUTE}
          >
            {spec.label}
          </Mono>
        ) : null}
      </>
    );
  }
  if (spec.kind === 'plate') {
    return (
      <>
        <div
          style={{
            position: 'absolute',
            left: spec.x - 3,
            top: spec.y - 3,
            width: spec.w + 6,
            height: spec.h + 6,
            border: `1.5px solid ${INK}`,
            background: PAPER,
          }}
        >
          <div style={{ position: 'absolute', left: 2, top: 2, overflow: 'hidden' }}>{picture}</div>
        </div>
        {spec.label ? (
          <Mono
            x={spec.x - 3}
            y={spec.y + spec.h + 14}
            w={Math.max(spec.w, 300)}
            size={16}
            color={MUTE}
          >
            {spec.label}
          </Mono>
        ) : null}
      </>
    );
  }
  return (
    <div style={{ position: 'absolute', left: spec.x, top: spec.y, overflow: 'hidden' }}>
      {picture}
    </div>
  );
}

const FULL: Box = { x: 0, y: 0, w: W, h: H };
const view = (b: Box) => {
  const s = Math.min(W / b.w, H / b.h);
  return { s, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
};

/** Camera state at t: scale and the stage point under the frame centre. */
export function camAt(cam: CamKey[], t: number) {
  if (cam.length === 0) return view(FULL);
  let prev = view(cam[0].box ?? FULL);
  for (let i = 0; i < cam.length; i += 1) {
    const k = cam[i];
    const target = view(k.box ?? FULL);
    if (t < k.at) return prev;
    if (k.dur > 0 && t < k.at + k.dur) {
      const p = CAM(cl((t - k.at) / k.dur));
      return {
        s: Math.exp(lerp(Math.log(prev.s), Math.log(target.s), p)),
        cx: lerp(prev.cx, target.cx, p),
        cy: lerp(prev.cy, target.cy, p),
      };
    }
    prev = target;
  }
  return prev;
}

/** Moves the stage so the camera box fills the frame; children are the panes (type stays outside). */
export function Camera({ cam, t, children }: { cam: CamKey[]; t: number; children: ReactNode }) {
  const { s, cx, cy } = camAt(cam, t);
  const tx = W / 2 - cx * s;
  const ty = H / 2 - cy * s;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: W,
        height: H,
        transformOrigin: '0 0',
        transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(4)})`,
      }}
    >
      {children}
    </div>
  );
}

/** The 3 second press ring around a button: fills from `from` to `to`, then flashes and leaves. */
export function Ring({ box, t, from, to }: { box: Box; t: number; from: number; to: number }) {
  if (t < from - 0.2 || t > to + 0.9) return null;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.max(box.w, box.h) / 2 + 26;
  const p = cl((t - from) / Math.max(0.1, to - from));
  const fadeIn = pr(t, from - 0.2, 0.25);
  const done = cl((t - to) / 0.9);
  const size = r * 2 + 20;
  const sw = 6;
  const circ = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        position: 'absolute',
        left: cx - size / 2,
        top: cy - size / 2,
        opacity: fadeIn * (1 - done),
        transform: `scale(${(1 + done * 0.35).toFixed(3)})`,
        transformOrigin: '50% 50%',
      }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={ORANGE}
        strokeWidth={1.5}
        opacity={0.35}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={ORANGE}
        strokeWidth={sw}
        strokeLinecap="butt"
        strokeDasharray={`${(circ * p).toFixed(2)} ${circ.toFixed(2)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
