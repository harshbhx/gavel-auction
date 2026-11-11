import { cl, IO, lerp, pr } from './anim';
import { INK, ORANGE } from './theme';

/* The mallet G of the brand, driven by time. Geometry is copied from brand/svg/mark-color.svg and the
   shared motion runtime (graphics/motion-devpost/runtime.js), never redrawn: the ring draws, the mallet
   swings in, strikes, the whole mark jolts and two orange rings leave the strike. */
export type MarkTiming = {
  ringStart?: number;
  swingStart?: number;
  swingDur?: number;
  echoes?: number[];
};

export const strikeTime = ({ swingStart = 0.3, swingDur = 0.9 }: MarkTiming) =>
  swingStart + 0.72 * swingDur;

export function Mark({
  t,
  size = 200,
  ink = INK,
  timing = {},
}: {
  t: number;
  size?: number;
  ink?: string;
  timing?: MarkTiming;
}) {
  const { ringStart = 0, swingStart = 0.3, swingDur = 0.9, echoes = [] } = timing;
  const strikes = [strikeTime(timing), ...echoes];
  const ringOff = 1 - IO(cl((t - ringStart) / 0.6));
  const u = (t - swingStart) / swingDur;
  let ang = 0;
  let op = 1;
  if (u < 0) {
    op = 0;
    ang = 72;
  } else if (u < 0.08) {
    op = u / 0.08;
    ang = 72;
  } else if (u < 0.58) ang = lerp(72, 94, IO((u - 0.08) / 0.5));
  else if (u < 0.72) ang = lerp(94, 0, Math.pow((u - 0.58) / 0.14, 2.2));
  let sc = 1;
  let a0 = 0;
  let k0 = 0;
  let a1 = 0;
  let k1 = 0;
  for (const s of strikes) {
    const x = (t - s) / 0.38;
    if (x > 0 && x < 1) sc = Math.min(sc, 1 - 0.07 * Math.sin(Math.PI * (1 - (1 - x) * (1 - x))));
    const w = (t - s) / 0.85;
    if (w > 0 && w < 1) {
      a0 = 0.9 * (1 - w);
      k0 = lerp(0.8, 1.85, 1 - Math.pow(1 - w, 4));
    }
    const w1 = (t - s - 0.14) / 0.85;
    if (w1 > 0 && w1 < 1) {
      a1 = 0.7 * (1 - w1);
      k1 = lerp(0.8, 2.2, 1 - Math.pow(1 - w1, 4));
    }
  }
  return (
    <svg
      viewBox="-22 -22 144 144"
      width={size}
      height={size}
      style={{ overflow: 'visible', display: 'block' }}
      role="img"
      aria-label="GAVEL"
    >
      <g transform={`translate(50 50) scale(${sc.toFixed(4)}) translate(-50 -50)`}>
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={ORANGE}
          strokeWidth="1.6"
          opacity={a0}
          transform={`translate(50 50) scale(${k0.toFixed(3)}) translate(-50 -50)`}
        />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={ORANGE}
          strokeWidth="1"
          opacity={a1}
          transform={`translate(50 50) scale(${k1.toFixed(3)}) translate(-50 -50)`}
        />
        <path
          pathLength={1}
          d="M78.98 23.90A39 39 0 1 0 89.00 50.00"
          fill="none"
          stroke={ink}
          strokeWidth="22"
          strokeDasharray="1"
          strokeDashoffset={ringOff}
        />
        <g transform={`rotate(${ang.toFixed(2)} 100 50)`} opacity={op}>
          <rect x="40" y="43.5" width="60" height="13" fill={ink} />
          <rect x="32" y="33" width="16" height="34" rx="3" fill={ORANGE} />
        </g>
      </g>
    </svg>
  );
}

/** Wide rings that leave a point at each strike (the stage-level shockwave). */
export function Waves({
  t,
  strikes,
  x,
  y,
  size = 240,
  n = 2,
  dur = 1.6,
  max = 7.5,
  min = 0.45,
  alpha = 0.8,
}: {
  t: number;
  strikes: number[];
  x: number;
  y: number;
  size?: number;
  n?: number;
  dur?: number;
  max?: number;
  min?: number;
  alpha?: number;
}) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        let best = 0;
        let sc = min;
        for (const s of strikes) {
          const w = (t - s - i * 0.16) / dur;
          if (w > 0 && w < 1) {
            best = alpha * Math.pow(1 - w, 1.4);
            sc = lerp(min, max, 1 - Math.pow(1 - w, 4));
          }
        }
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              borderRadius: '50%',
              border: `${i === 0 ? 1.5 : 1}px solid ${ORANGE}`,
              opacity: best,
              transform: `scale(${sc.toFixed(3)})`,
            }}
          />
        );
      })}
    </>
  );
}

/** The horizontal lockup: the mark strikes, then the letters G A V E L rise one by one. 688x220 at scale 1. */
export function Lockup({
  t,
  x,
  y,
  scale = 1,
  letters,
  ink = INK,
  lettersAt = 0.95,
  timing = { swingStart: 0.25, swingDur: 0.85 },
}: {
  t: number;
  x: number;
  y: number;
  scale?: number;
  letters: string[];
  ink?: string;
  lettersAt?: number;
  timing?: MarkTiming;
}) {
  const strike = strikeTime(timing);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 688,
        height: 220,
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
      }}
    >
      <Waves t={t} strikes={[strike]} x={110} y={110} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: 220, height: 220 }}>
        <Mark t={t} size={220} ink={ink} timing={timing} />
      </div>
      <svg
        viewBox="-22 -22 450.24 144"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 688,
          height: 220,
          overflow: 'visible',
        }}
      >
        <g transform="translate(31 13) scale(0.74)" fill={ink} style={{ color: ink }}>
          {letters.slice(1).map((l, i) => {
            const p = pr(t, lettersAt + i * 0.07, 0.6);
            return (
              <g
                key={i}
                transform={`translate(${lerp(-60, 0, p).toFixed(2)} 0)`}
                opacity={Math.min(1, p * 2.5)}
                dangerouslySetInnerHTML={{ __html: l }}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
