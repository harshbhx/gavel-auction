// Props of the Film composition. compose.mjs resolves everything that depends on the recording
// (frame lists, speeds, event times, camera targets) so every component is a pure function of time.

export type Box = { x: number; y: number; w: number; h: number };

export type PaneSpec = {
  id: string;
  actor: string;
  /** Stage rectangle of the recorded picture (CSS px of the 1920x1080 frame). */
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'phone' | 'plate' | 'bare';
  label?: string;
  /** Scene seconds in which this pane is on screen. */
  from: number;
  to: number;
  /** Recording time (epoch s) shown at scene second `from`, and the fast-forward factor. */
  startAbs: number;
  speed: number;
  /** Frames of the actor in the needed window: [timestamp, public path]. Empty when the shot failed. */
  frames: [number, string][];
  /** Element rectangles in stage coordinates, from the recorder (camera targets). */
  rects: Record<string, Box>;
};

/** Camera keyframe: from `at`, over `dur` seconds, move to `box` (null = the whole frame). */
export type CamKey = { at: number; dur: number; box: Box | null };

export type Cap = {
  a: number;
  b: number;
  /** Display line; **word** marks the orange word. */
  text: string;
  sub?: string;
};

export type Chapter = { n: number; name: string };

export type SceneProps = {
  id: string;
  dur: number;
  world: 'ink' | 'paper';
  chapter?: Chapter;
  panes: PaneSpec[];
  cam: CamKey[];
  caps: Cap[];
  /** Named instants in scene seconds (press, released, first bid, ...), already resolved. */
  ev: Record<string, number>;
  /** Free data for the scene (API answers, numbers). */
  data: Record<string, unknown>;
};

export type FilmProps = {
  fps: number;
  scenes: SceneProps[];
  /** The five letters of the wordmark as inline SVG group strings, from brand/svg/lockup-h-color.svg. */
  letters: string[];
};
