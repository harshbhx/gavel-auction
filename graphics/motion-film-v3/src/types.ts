import type { World } from './theme';

export type Cap = {
  a: number;
  b: number;
  /** Display text; `**word**` marks the orange word, ` / ` breaks a line. */
  text: string;
};

export type SceneSpec = {
  id: string;
  dur: number;
  world: World;
  /** The scene draws its own type; the caps are only for the SRT. */
  srtOnly?: boolean;
  caps: Cap[];
};

export type FilmProps = {
  fps: number;
  /** Scene ids to render, in order (the style test renders a subset). */
  ids: string[];
  /** Render scale (1 = 1920x1080). */
  scale: number;
  /** The five letters of the wordmark as inline SVG group strings, from brand/svg/lockup-h-color.svg. */
  letters: string[];
  /** Show the official PayPal mark on the built-with beat (owner decision pending; default off). */
  sponsorLogos: boolean;
};

export type SceneCtx = {
  t: number;
  dur: number;
  fps: number;
  frame: number;
  spec: SceneSpec;
  letters: string[];
  sponsorLogos: boolean;
};
