/** 24x24 stroke icons drawn on currentColor. Each value is the inner SVG markup of one icon. */
export const ICON_PATHS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  hollow: '<circle cx="12" cy="12" r="7"/>',
  current: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
  keyboard:
    '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.5M11 10h.5M15 10h.5M7 14h10"/>',
  hand: '<path d="M8 12V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7a7 7 0 01-7 7 6 6 0 01-5-3l-2-3a1.5 1.5 0 012.5-1.5L8 14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;
