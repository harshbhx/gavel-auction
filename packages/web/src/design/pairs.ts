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
  { fg: '--color-fg', bg: '--color-panel', kind: 'normal' },
  { fg: '--color-fg', bg: '--color-panel-2', kind: 'normal' },
  { fg: '--color-fg-muted', bg: '--color-panel', kind: 'normal' },
  { fg: '--color-fg-muted', bg: '--color-panel-2', kind: 'normal' },
  { fg: '--color-signal-ink', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-signal-ink', bg: '--color-panel', kind: 'normal' },
  { fg: '--color-signal-ink', bg: '--color-panel-2', kind: 'normal' },
  { fg: '--color-on-signal', bg: '--color-signal', kind: 'normal' },
  { fg: '--color-go', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-go', bg: '--color-panel', kind: 'normal' },
  { fg: '--color-go', bg: '--color-panel-2', kind: 'normal' },
  { fg: '--color-stop', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-stop', bg: '--color-panel', kind: 'normal' },
  { fg: '--color-stop', bg: '--color-panel-2', kind: 'normal' },
  { fg: '--color-info', bg: '--color-bg', kind: 'normal' },
  { fg: '--color-info', bg: '--color-panel', kind: 'normal' },
  { fg: '--color-info', bg: '--color-panel-2', kind: 'normal' },
  { fg: '--color-border', bg: '--color-panel', kind: 'ui' },
  { fg: '--color-focus', bg: '--color-panel', kind: 'ui' },
];
