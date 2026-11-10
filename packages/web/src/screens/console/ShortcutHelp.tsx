import { useEffect } from 'react';
type ShortcutLabel =
  | 'shortcuts.help'
  | 'console.open'
  | 'console.pause'
  | 'console.resume'
  | 'shortcuts.extend';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Dialog } from '../../design/primitives/Dialog';

export type ShortcutId = 'help' | 'open' | 'pause' | 'resume' | 'extend';

export interface ShortcutDef {
  readonly id: ShortcutId;
  /** Key or chord, for example `?` or `Alt+H`. */
  readonly keys: string;
  readonly label: ShortcutLabel;
  /** Hammer and stop are destructive and must never be a single key. */
  readonly destructive: boolean;
}

/** Every keyboard shortcut of the console. Hammer and stop have none, by design. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'help', keys: '?', label: 'shortcuts.help', destructive: false },
  { id: 'open', keys: 'o', label: 'console.open', destructive: false },
  { id: 'pause', keys: 'p', label: 'console.pause', destructive: false },
  { id: 'resume', keys: 'r', label: 'console.resume', destructive: false },
  { id: 'extend', keys: 'e', label: 'shortcuts.extend', destructive: false },
];

export function isSingleKey(keys: string): boolean {
  return !keys.includes('+') || keys === '+';
}

/** True when the event target is a place the user types into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export type ShortcutHandlers = Readonly<Partial<Record<ShortcutId, () => void>>>;

/** Window key handler. Ignores typing targets, modified keys and key repeat. */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const def = SHORTCUTS.find((s) => s.keys === e.key && !s.destructive);
      if (def === undefined) return;
      const handler = handlers[def.id];
      if (handler === undefined) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}

export interface ShortcutHelpProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  return (
    <Dialog open={open} onClose={onClose} title={t('console.shortcuts')}>
      <h2>{t('console.shortcuts')}</h2>
      <dl>
        {SHORTCUTS.map((s) => (
          <div key={s.id}>
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{t(s.label)}</dd>
          </div>
        ))}
      </dl>
      <p>{t('shortcuts.confirmTwice')}</p>
      <p>{t('shortcuts.noSingleKey')}</p>
      <Button onClick={onClose}>{t('shortcuts.close')}</Button>
    </Dialog>
  );
}
