import { cl, ENTER } from './anim';
import data from './captions.json';
import { BODY, PAPER_HI } from './theme';

/* Burned-in captions: the narration, line by line, in film seconds (captions.json is written by
   voiceover.mjs from the take's word timings, so the text lands with the voice). One line, bottom centre,
   on an ink plate that reads on the ink and the paper stage alike and at phone size. */
export type Cue = { a: number; b: number; text: string; scene: string };
export const CUES = data.cues as Cue[];

export function Captions({ t }: { t: number }) {
  const cue = CUES.find((c) => t >= c.a && t < c.b);
  if (!cue) return null;
  const p = ENTER(cl((t - cue.a) / 0.2));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 36, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 1680,
          padding: '13px 36px 16px',
          borderRadius: 14,
          background: 'rgba(14, 10, 8, 0.88)',
          boxShadow: 'inset 0 0 0 1.5px rgba(239, 230, 211, 0.16), 0 14px 44px rgba(0, 0, 0, 0.35)',
          color: PAPER_HI,
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 50,
          lineHeight: 1.22,
          letterSpacing: '-0.005em',
          textAlign: 'center',
          opacity: cl(p * 1.4),
          transform: `translateY(${((1 - p) * 10).toFixed(1)}px)`,
        }}
      >
        {cue.text}
      </div>
    </div>
  );
}
