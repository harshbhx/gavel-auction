import { type ElementType, type PointerEvent, type ReactNode } from 'react';
import { useReducedMotion } from './hooks';

/**
 * A card with a soft highlight that follows the pointer. Original code; the idea is shared by the
 * React Bits and Aceternity spotlight cards. The highlight is a faint tint under the content, set by
 * two CSS variables, and is never used on touch or under reduced motion.
 */
export function SpotlightCard({
  as,
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const Tag: ElementType = as ?? 'div';
  const move = (e: PointerEvent<HTMLElement>): void => {
    if (reduced || e.pointerType !== 'mouse') return;
    const box = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--fx-x', `${e.clientX - box.left}px`);
    e.currentTarget.style.setProperty('--fx-y', `${e.clientY - box.top}px`);
  };
  return (
    <Tag className={`fx-spot ${className ?? ''}`.trim()} onPointerMove={move}>
      {children}
    </Tag>
  );
}
