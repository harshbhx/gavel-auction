import type { ComponentType } from 'react';
import { AbsoluteFill, Series, useVideoConfig } from 'remotion';
import { useT } from './anim';
import { Hook, Mechanism, Problem, Title } from './scenes/intro';
import { BuiltWith, Judges, Open, Outro, Proof, Speed } from './scenes/proof';
import { Bid, Hammer, Hold, Join, Voice } from './scenes/room';
import { Receipt, Settle } from './scenes/settle';
import table from './scenes.json';
import { H, INK, W } from './theme';
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
  builtWith: BuiltWith,
  open: Open,
  outro: Outro,
};

export const SPECS = table.scenes as SceneSpec[];
export const specOf = (id: string) => SPECS.find((s) => s.id === id);

function Scene({ spec, letters, sponsorLogos }: { spec: SceneSpec; letters: string[]; sponsorLogos: boolean }) {
  const { t, fps, frame } = useT();
  const C = SCENES[spec.id];
  if (!C) return <AbsoluteFill style={{ background: INK }} />;
  return <C t={t} dur={spec.dur} fps={fps} frame={frame} spec={spec} letters={letters} sponsorLogos={sponsorLogos} />;
}

/** The film: hard cuts between scenes; the shared-element moves and wipes live inside the scenes. */
export function Film({ ids, letters, scale, sponsorLogos }: FilmProps) {
  const { fps } = useVideoConfig();
  const specs = ids.map(specOf).filter((s): s is SceneSpec => Boolean(s));
  return (
    <AbsoluteFill style={{ background: INK }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <Series>
          {specs.map((sc) => (
            <Series.Sequence key={sc.id} name={sc.id} durationInFrames={Math.max(1, Math.round(sc.dur * fps))}>
              <Scene spec={sc} letters={letters} sponsorLogos={sponsorLogos} />
            </Series.Sequence>
          ))}
        </Series>
      </div>
    </AbsoluteFill>
  );
}
