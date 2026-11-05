export type ConfirmShortcut = 'confirm' | 'reject' | 'next' | 'previous';

export interface ShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target: EventTarget | null;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when typing would go into the target, so a letter key is text and not a shortcut. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (el === null || typeof el !== 'object') return false;
  if (el.isContentEditable === true) return true;
  return typeof el.tagName === 'string' && EDITABLE_TAGS.has(el.tagName.toUpperCase());
}

/**
 * Maps a key press to a confirm queue action: Y confirm, N reject, J next, K previous.
 * Returns null while a field has focus or a modifier key is held (R-WEB-067).
 */
export function confirmShortcut(ev: ShortcutEvent): ConfirmShortcut | null {
  if (ev.ctrlKey === true || ev.metaKey === true || ev.altKey === true) return null;
  if (isEditableTarget(ev.target)) return null;
  switch (ev.key.toLowerCase()) {
    case 'y':
      return 'confirm';
    case 'n':
      return 'reject';
    case 'j':
      return 'next';
    case 'k':
      return 'previous';
    default:
      return null;
  }
}
