import type { ComponentType } from 'react';
import { AbsoluteFill, Series, useVideoConfig } from 'remotion';
import {
  BuiltWith,
  Cold,
  Idea,
  Judges,
  OpenItems,
  Outro,
  PageSpeed,
  Problem,
  Proof,
  Settle,
  Title,
  Voice,
} from './cards';
import { Bid, Hammer, Hold, Join, Open, Receipt, Verify } from './shots';
import { INK } from './theme';
import type { FilmProps, SceneProps } from './types';

type SceneComponent = ComponentType<{ sc: SceneProps; letters: string[] }>;

const SCENES: Record<string, SceneComponent> = {
  cold: Cold,
  title: Title,
  problem: Problem,
  idea: Idea,
  open: Open,
  join: Join,
  hold: Hold,
  bid: Bid,
  voice: Voice,
  hammer: Hammer,
  settle: Settle,
  receipt: Receipt,
  verify: Verify,
  proof: Proof,
  pagespeed: PageSpeed,
  judges: Judges,
  builtWith: BuiltWith,
  openItems: OpenItems,
  outro: Outro,
};

/** The film: hard cuts between scenes (the two wipes and the strikes live inside the scenes). */
export function Film({ scenes, letters }: FilmProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Series>
        {scenes.map((sc) => {
          const Scene = SCENES[sc.id];
          return (
            <Series.Sequence
              key={sc.id}
              name={sc.id}
              durationInFrames={Math.max(1, Math.round(sc.dur * fps))}
            >
              {Scene ? (
                <Scene sc={sc} letters={letters} />
              ) : (
                <AbsoluteFill style={{ background: INK }} />
              )}
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
}
