/** 24x24 stroke icons drawn on currentColor. Each icon is a list of SVG shapes, rendered as React elements. */
export type IconShape =
  | { readonly tag: 'path'; readonly d: string; readonly fill?: string }
  | {
      readonly tag: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill?: string;
    }
  | {
      readonly tag: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
    };

export const ICON_PATHS = {
  check: [{ tag: 'path', d: 'M5 12.5l4.5 4.5L19 7.5' }] as readonly IconShape[],
  hollow: [{ tag: 'circle', cx: 12, cy: 12, r: 7 }] as readonly IconShape[],
  current: [
    { tag: 'circle', cx: 12, cy: 12, r: 7 },
    { tag: 'circle', cx: 12, cy: 12, r: 3, fill: 'currentColor' },
  ] as readonly IconShape[],
  warning: [
    { tag: 'path', d: 'M12 4l9 16H3z' },
    { tag: 'path', d: 'M12 10v4' },
    { tag: 'path', d: 'M12 17.5v.5' },
  ] as readonly IconShape[],
  mic: [
    { tag: 'rect', x: 9, y: 3, width: 6, height: 11, rx: 3 },
    { tag: 'path', d: 'M5 11a7 7 0 0014 0' },
    { tag: 'path', d: 'M12 18v3' },
  ] as readonly IconShape[],
  qr: [
    { tag: 'rect', x: 4, y: 4, width: 6, height: 6 },
    { tag: 'rect', x: 14, y: 4, width: 6, height: 6 },
    { tag: 'rect', x: 4, y: 14, width: 6, height: 6 },
    { tag: 'path', d: 'M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2' },
  ] as readonly IconShape[],
  keyboard: [
    { tag: 'rect', x: 3, y: 6, width: 18, height: 12, rx: 2 },
    { tag: 'path', d: 'M7 10h.5M11 10h.5M15 10h.5M7 14h10' },
  ] as readonly IconShape[],
  hand: [
    {
      tag: 'path',
      d: 'M8 12V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7a7 7 0 01-7 7 6 6 0 01-5-3l-2-3a1.5 1.5 0 012.5-1.5L8 14',
    },
  ] as readonly IconShape[],
  lock: [
    { tag: 'rect', x: 5, y: 11, width: 14, height: 9, rx: 2 },
    { tag: 'path', d: 'M8 11V8a4 4 0 018 0v3' },
  ] as readonly IconShape[],
  clock: [
    { tag: 'circle', cx: 12, cy: 12, r: 8 },
    { tag: 'path', d: 'M12 8v4l3 2' },
  ] as readonly IconShape[],
  stop: [{ tag: 'rect', x: 6, y: 6, width: 12, height: 12, rx: 1 }] as readonly IconShape[],
  play: [{ tag: 'path', d: 'M8 5l11 7-11 7z' }] as readonly IconShape[],
  pause: [{ tag: 'path', d: 'M8 5v14M16 5v14' }] as readonly IconShape[],
} as const;

export type IconName = keyof typeof ICON_PATHS;
