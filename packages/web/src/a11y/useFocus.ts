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

    // After a click on the backdrop focus can sit on the body: pull it back inside, so Tab and
    // Shift+Tab never reach the page behind a modal.
    const pullBack = (): void => {
      if (container.contains(document.activeElement)) return;
      const items = getFocusable(container);
      (items[0] ?? container).focus();
    };
    const inOtherModal = (el: EventTarget | null): boolean =>
      el instanceof Element && el.closest('[aria-modal="true"]') !== null;
    const onDocKeyDown = (e: KeyboardEvent): void => {
      if (
        e.key === 'Tab' &&
        !container.contains(document.activeElement) &&
        !inOtherModal(document.activeElement)
      ) {
        e.preventDefault();
        pullBack();
      }
    };
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof Node && !container.contains(e.target) && !inOtherModal(e.target))
        pullBack();
    };

    container.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onDocKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      container.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onDocKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      const trigger = triggerRef.current;
      if (trigger !== null && typeof trigger.focus === 'function') {
        trigger.focus();
      }
    };
  }, [options.active, ref]);
}

/** Runs `onEscape` for the Escape key anywhere in the document while `active` is true. */
export function useEscapeKey(onEscape: () => void, active: boolean): void {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') latest.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

/** Keeps focus where it is when the press lands on the bare overlay (not on its panel). */
export function keepFocusOnOverlay(e: {
  target: EventTarget;
  currentTarget: EventTarget;
  preventDefault: () => void;
}): void {
  if (e.target === e.currentTarget) e.preventDefault();
}
