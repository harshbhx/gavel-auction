import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true',
  );
}

export interface UseFocusTrapOptions {
  readonly active: boolean;
}

/**
 * Traps Tab and Shift+Tab inside the referenced container while `active` is true.
 * Returns focus to the element that was focused when the trap activated.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions,
): void {
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!options.active) return;
    const container = ref.current;
    if (container === null) return;

    triggerRef.current = document.activeElement as HTMLElement | null;

    const focusable = getFocusable(container);
    const first = focusable[0];
    if (first !== undefined) {
      first.focus();
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = getFocusable(container);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (firstItem === undefined || lastItem === undefined) return;

      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);

    return () => {
      container.removeEventListener('keydown', onKeyDown);
      const trigger = triggerRef.current;
      if (trigger !== null && typeof trigger.focus === 'function') {
        trigger.focus();
      }
    };
  }, [options.active, ref]);
}
