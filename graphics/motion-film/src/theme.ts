import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

// The brand: flat paper, black ink, one orange. The app's own fonts (variable), linked into public/
// by compose.mjs from packages/web/src/design/fonts.
export const INK = '#1d1712';
export const PAPER = '#efe6d3';
export const ORANGE = '#ff6a1f';
export const MUTE = '#6f6250';
export const PALE = '#cbbfa6';
/** Muted paper for mono text on ink. */
export const DIM = '#a89b82';

export const DISPLAY = "'Big Shoulders Display Variable', 'Arial Narrow', sans-serif";
export const BODY = "'Public Sans Variable', system-ui, sans-serif";
export const MONO = "'JetBrains Mono Variable', ui-monospace, monospace";

export const W = 1920;
export const H = 1080;

// loadFont delays the render until the face is ready, so no frame is captured with a fallback font.
loadFont({
  family: 'Big Shoulders Display Variable',
  url: staticFile('fonts/big-shoulders-display-latin-wght-normal.woff2'),
  weight: '100 900',
});
loadFont({
  family: 'Public Sans Variable',
  url: staticFile('fonts/public-sans-latin-wght-normal.woff2'),
  weight: '100 900',
});
loadFont({
  family: 'JetBrains Mono Variable',
  url: staticFile('fonts/jetbrains-mono-latin-wght-normal.woff2'),
  weight: '100 900',
});

export const worldColors = (world: 'ink' | 'paper') =>
  world === 'ink'
    ? { bg: INK, fg: PAPER, mute: DIM, line: PAPER }
    : { bg: PAPER, fg: INK, mute: MUTE, line: INK };
