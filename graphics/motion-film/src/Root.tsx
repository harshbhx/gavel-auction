import { Composition } from 'remotion';
import { Film } from './Film';
import type { FilmProps } from './types';
import { H, W } from './theme';

// compose.mjs passes the resolved props (props.json). The duration is the sum of the scene lengths at
// the chosen frame rate, so a 30 fps quick pass and the 60 fps final share one timeline in seconds.
const defaultProps: FilmProps = { fps: 60, scenes: [], letters: [] };

export const RemotionRoot = () => {
  return (
    <Composition
      id="Film"
      component={Film}
      durationInFrames={60}
      fps={60}
      width={W}
      height={H}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const dur = props.scenes.reduce((n, s) => n + s.dur, 0);
        return {
          fps: props.fps,
          durationInFrames: Math.max(
            1,
            props.scenes.reduce((n, s) => n + Math.max(1, Math.round(s.dur * props.fps)), 0),
          ),
          props,
          defaultOutName: `gavel-launch-film-${Math.round(dur)}s`,
        };
      }}
    />
  );
};
