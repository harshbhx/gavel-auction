import type { ComponentType } from 'react';
import { AbsoluteFill, Series, useCurrentFrame, useVideoConfig } from 'remotion';
import { useT } from './anim';
import { Captions } from './captions';
import { Docs } from './scenes/docs';
import { Hook, Mechanism, Problem, Title } from './scenes/intro';
import { BuiltWith, Judges, Outro, Proof, Speed } from './scenes/proof';
import { Bid, Hammer, Hold, Join, Voice } from './scenes/room';
import { Receipt, Settle } from './scenes/settle';
import table from './scenes.json';
import { H, INK, INK_DEEP, ORANGE, W } from './theme';
import type { FilmProps, SceneCtx, SceneSpec } from './types';

const SCENES: Record<string, ComponentType<SceneCtx>> = {
  hook: Hook,
  title: Title,
  problem: Problem,
  mechanism: Mechanism,
  join: Join,
  hold: Hold,
  bid: Bid,
  voice: Voice,
  hammer: Hammer,
  settle: Settle,
  receipt: Receipt,
  proof: Proof,
  speed: Speed,
  judges: Judges,
  docs: Docs,
  builtWith: BuiltWith,
  outro: Outro,
};

export const SPECS = table.scenes as SceneSpec[];
export const specOf = (id: string) => SPECS.find((s) => s.id === id);

/** The cut between scenes: two curtains (orange, then ink behind it) sweep off to the right, so every scene change
    reads as one deliberate move and the new scene is revealed by it. Not on the first scene. */
function Wipe({ t }: { t: number }) {
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const a = ease(t / 0.42);
  const b = ease((t - 0.06) / 0.5);
  if (b >= 1) return null;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: INK_DEEP,
          transform: `translateX(${(b * 104).toFixed(2)}%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: ORANGE,
          transform: `translateX(${(a * 104).toFixed(2)}%)`,
        }}
      />
    </>
  );
}

function Scene({
  spec,
  letters,
  sponsorLogos,
}: {
  spec: SceneSpec;
  letters: string[];
  sponsorLogos: boolean;
}) {
  const { t, fps, frame } = useT();
  const C = SCENES[spec.id];
  if (!C) return <AbsoluteFill style={{ background: INK }} />;
  return (
    <AbsoluteFill>
      <C
        t={t}
        dur={spec.dur}
        fps={fps}
        frame={frame}
        spec={spec}
        letters={letters}
        sponsorLogos={sponsorLogos}
      />
      {spec.id !== 'hook' ? <Wipe t={t} /> : null}
    </AbsoluteFill>
  );
}

/** The film: hard cuts between scenes; the shared-element moves and wipes live inside the scenes; the
    narration captions sit on top of every scene, in film time. */
export function Film({ ids, letters, scale, sponsorLogos, captions = true }: FilmProps) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  // A cut that starts later in the film (the stills, a style test) keeps the film's clock for the captions.
  const first = SPECS.findIndex((s) => s.id === ids[0]);
  const offset = SPECS.slice(0, Math.max(0, first)).reduce((n, s) => n + s.dur, 0);
  const contiguous = ids.every((id, i) => SPECS[first + i]?.id === id);
  const specs = ids.map(specOf).filter((s): s is SceneSpec => Boolean(s));
  return (
    <AbsoluteFill style={{ background: INK }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: W,
          height: H,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <Series>
          {specs.map((sc) => (
            <Series.Sequence
              key={sc.id}
              name={sc.id}
              durationInFrames={Math.max(1, Math.round(sc.dur * fps))}
            >
              <Scene spec={sc} letters={letters} sponsorLogos={sponsorLogos} />
            </Series.Sequence>
          ))}
        </Series>
        {captions && contiguous ? <Captions t={offset + frame / fps} /> : null}
      </div>
    </AbsoluteFill>
  );
}
