import { Easing, spring, useCurrentFrame, useVideoConfig } from 'remotion';

// Motion language (STORYBOARD-V3.md): one entrance curve, one exit curve, one camera curve, one spring
// preset for UI. Time is always scene seconds.
export const ENTER = Easing.bezier(0.16, 1, 0.3, 1);
export const EXIT = Easing.bezier(0.7, 0, 0.84, 0);
export const CAM = Easing.bezier(0.65, 0, 0.35, 1);
export const IO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export const cl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const mix = (a: number, b: number, t: number, at: number, d: number, e = ENTER) =>
  lerp(a, b, e(cl((t - at) / d)));

/** Eased progress of a move that starts at `a` and lasts `d` seconds. */
export const pr = (t: number, a: number, d: number, e: (x: number) => number = ENTER) =>
  e(cl((t - a) / d));

/** Scene time in seconds and the frame rate. */
export const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { t: frame / fps, fps, frame };
};

/** 0 before `a`, 1 after `a + d`, with the entrance curve; exits again from `out` if given. */
export const inOut = (t: number, a: number, d: number, out?: number, od = 0.3) => {
  const i = pr(t, a, d);
  if (out === undefined) return i;
  return i * (1 - pr(t, out, od, EXIT));
};

/** Spring from 0 to 1 that starts at `a` (UI physics only). */
export const sp = (
  t: number,
  a: number,
  fps: number,
  cfg: { damping?: number; stiffness?: number; mass?: number } = {},
) =>
  t < a
    ? 0
    : spring({
        frame: (t - a) * fps,
        fps,
        config: { damping: 16, stiffness: 150, mass: 1, ...cfg },
      });

/** A press: down over 0.12 s, back over 0.25 s, starting at `a`. 0..1 */
export const press = (t: number, a: number) => {
  const x = t - a;
  if (x < 0) return 0;
  if (x < 0.12) return x / 0.12;
  if (x < 0.37) return 1 - (x - 0.12) / 0.25;
  return 0;
};

/** A pulse every `period` seconds from `a`, 1 at the beat decaying to 0. */
export const pulse = (t: number, a: number, period: number) => {
  if (t < a) return 0;
  const x = ((t - a) % period) / period;
  return Math.pow(1 - x, 3);
};

/** Formats cents as $12.34, or $12 when whole and `whole` is set. */
export const usd = (cents: number, whole = false) =>
  whole && cents % 100 === 0
    ? `$${(cents / 100).toLocaleString('en-US')}`
    : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Deterministic pseudo-random in [0, 1) from integers (no Math.random in a render). */
export const hash = (...n: number[]) => {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v * 1000) & 0xffffffff;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
};

/** Camera state and keyframes. */
export type Cam = { s?: number; rx?: number; ry?: number; x?: number; y?: number; z?: number };
export type CamKey = { at: number; dur: number; cam: Cam };
const ZERO: Required<Cam> = { s: 1, rx: 0, ry: 0, x: 0, y: 0, z: 0 };
export function camAt(t: number, keys: CamKey[]): Required<Cam> {
  let cur: Required<Cam> = { ...ZERO, ...(keys[0]?.cam ?? {}) };
  for (let i = 1; i < keys.length; i += 1) {
    const k = keys[i];
    const target = { ...cur, ...k.cam };
    const p = pr(t, k.at, Math.max(0.001, k.dur), CAM);
    cur = {
      s: lerp(cur.s, target.s, p),
      rx: lerp(cur.rx, target.rx, p),
      ry: lerp(cur.ry, target.ry, p),
      x: lerp(cur.x, target.x, p),
      y: lerp(cur.y, target.y, p),
      z: lerp(cur.z, target.z, p),
    };
  }
  return cur;
}
export const camCss = (c: Required<Cam>) =>
  `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, ${c.z.toFixed(1)}px) rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg) scale(${c.s.toFixed(4)})`;
