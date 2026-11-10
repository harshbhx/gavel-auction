import { Easing, useCurrentFrame, useVideoConfig } from 'remotion';

// The motion language of the film (see STORYBOARD.md, "Tooling"): one entrance curve, one exit
// curve, one camera curve. Base unit 0.4 s.
export const ENTER = Easing.bezier(0.16, 1, 0.3, 1);
export const EXIT = Easing.bezier(0.7, 0, 0.84, 0);
export const CAM = Easing.bezier(0.65, 0, 0.35, 1);
export const IO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export const cl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Eased progress of a move that starts at `a` and lasts `d` seconds. */
export const pr = (t: number, a: number, d: number, e: (x: number) => number = ENTER) =>
  e(cl((t - a) / d));

/** Scene time in seconds. */
export const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
};

/** 0 before `a`, 1 after `a + d`, with the entrance curve; exits again from `out` if given. */
export const inOut = (t: number, a: number, d: number, out?: number, od = 0.3) => {
  const i = pr(t, a, d);
  if (out === undefined) return i;
  return i * (1 - pr(t, out, od, EXIT));
};

/** Formats cents as $12.34 or $12 when whole. */
export const usd = (cents: number, whole = false) =>
  whole && cents % 100 === 0
    ? `$${(cents / 100).toFixed(0)}`
    : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
