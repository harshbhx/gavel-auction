/** Every foreground/background colour pair the UI uses, with the contrast the pair must reach. */
export type PairKind = 'normal' | 'large' | 'ui';

export interface ColorPair {
  readonly fg: string;
  readonly bg: string;
  readonly kind: PairKind;
}

/** WCAG minimum ratios: 4.5 for body text, 3 for large text and UI borders and indicators. */
export const MIN_RATIO: Readonly<Record<PairKind, number>> = {
  normal: 4.5,
  large: 3,
  ui: 3,
};

export const THEMES = ['light', 'dark', 'projector'] as const;
export type ThemeName = (typeof THEMES)[number];

export const COLOR_PAIRS: readonly ColorPair[] = [
  { fg: '--color-fg', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-fg', bg: '--color-surface', kind: 'normal' },
  { fg: '--color-fg-muted', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-fg-muted', bg: '--color-surface', kind: 'normal' },
  { fg: '--color-accent', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-accent', bg: '--color-surface', kind: 'normal' },
  { fg: '--color-on-accent', bg: '--color-accent', kind: 'normal' },
  { fg: '--color-success', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-success', bg: '--color-surface', kind: 'normal' },
  { fg: '--color-warning', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-warning', bg: '--color-surface', kind: 'normal' },
  { fg: '--color-danger', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-danger', bg: '--color-surface', kind: 'normal' },
  { fg: '--color-border', bg: '--color-bg', kind: 'ui' },
  { fg: '--color-border', bg: '--color-surface', kind: 'ui' },
  { fg: '--color-focus', bg: '--color-bg', kind: 'ui' },
  { fg: '--color-focus', bg: '--color-surface', kind: 'ui' },
  // Scoreboard additions: raised panels, action and state fills, sheet, hold bar, slider.
  { fg: '--color-fg', bg: '--color-raised', kind: 'normal' },
  { fg: '--color-fg-muted', bg: '--color-raised', kind: 'normal' },
  { fg: '--color-border', bg: '--color-raised', kind: 'ui' },
  { fg: '--color-on-action', bg: '--color-action', kind: 'normal' },
  { fg: '--color-ring', bg: '--color-action', kind: 'ui' },
  { fg: '--color-on-charged', bg: '--color-charged', kind: 'normal' },
  { fg: '--color-on-danger', bg: '--color-danger', kind: 'normal' },
  { fg: '--color-on-sheet', bg: '--color-sheet', kind: 'normal' },
  { fg: '--color-on-win', bg: '--color-win', kind: 'normal' },
  { fg: '--color-on-out', bg: '--color-out', kind: 'normal' },
  { fg: '--color-win', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-out', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-held', bg: '--color-bg', kind: 'ui' },
  { fg: '--color-held', bg: '--color-surface', kind: 'ui' },
  { fg: '--color-charged', bg: '--color-surface', kind: 'ui' },
  { fg: '--color-released', bg: '--color-surface', kind: 'ui' },
  { fg: '--color-fg', bg: '--color-slider-fill', kind: 'ui' },
  { fg: '--color-fg-muted', bg: '--color-slider-fill', kind: 'ui' },
];
