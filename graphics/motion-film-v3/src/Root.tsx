import { Composition } from 'remotion';
import { Film, specOf } from './Film';
import { H, W } from './theme';
import type { FilmProps } from './types';

// compose.mjs passes props.json: the scene ids, fps, render scale and the wordmark letters. The duration is the
// sum of the scene lengths at the chosen frame rate, so a 30 fps test and the 60 fps final share one timeline.
const defaultProps: FilmProps = { fps: 60, ids: [], scale: 1, letters: [], sponsorLogos: false };

export const RemotionRoot = () => (
  <Composition
    id="Film"
    component={Film}
    durationInFrames={60}
    fps={60}
    width={W}
    height={H}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => {
      const specs = props.ids.map(specOf).filter(Boolean);
      const frames = specs.reduce((n, s) => n + Math.max(1, Math.round((s?.dur ?? 0) * props.fps)), 0);
      return {
        fps: props.fps,
        durationInFrames: Math.max(1, frames),
        width: Math.round(W * props.scale),
        height: Math.round(H * props.scale),
        props,
      };
    }}
  />
);
