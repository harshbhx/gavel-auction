import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

// The brand (brand/tokens.json): ink, paper, orange. The deep ink stage and the glows are the only
// additions; no blue, navy or grey UI anywhere. Fonts are the app's own, linked into public/ by compose.mjs.
export const INK = '#1d1712';
export const INK_DEEP = '#120e0b';
export const PAPER = '#efe6d3';
export const PAPER_HI = '#f8f2e4';
export const PAPER_LO = '#e6dac1';
export const ORANGE = '#ff6a1f';
export const ORANGE_DEEP = '#a33a06';
export const MUTE = '#6f6250';
export const DIM = '#a89b82';
export const RULE_PAPER = '#d3c5a8';
export const RULE_INK = '#3a2f27';

export const DISPLAY = "'Big Shoulders Display Variable', 'Arial Narrow', sans-serif";
export const BODY = "'Public Sans Variable', system-ui, sans-serif";
export const MONO = "'JetBrains Mono Variable', ui-monospace, monospace";

export const W = 1920;
export const H = 1080;
export const BEAT = 0.5;

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

export type World = 'ink' | 'paper';
export const colors = (world: World) =>
  world === 'ink'
    ? { bg: INK, fg: PAPER, mute: DIM, rule: RULE_INK, card: '#241c16', cardHi: '#2d231c' }
    : { bg: PAPER, fg: INK, mute: MUTE, rule: RULE_PAPER, card: PAPER_HI, cardHi: '#ffffff' };
