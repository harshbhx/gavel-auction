import { type CSSProperties } from 'react';
import { useReducedMotion } from './hooks';

/**
 * Word by word blur reveal. Original code in the style of the React Bits BlurText effect.
 * The words are in the page from the first paint and keep full opacity, so the text is the
 * largest contentful paint element without any script; only a short blur and rise is animated.
 * Under reduced motion no animation class is set at all.
 */
export function BlurText({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  const words = text.split(' ');
  return (
    <span className={className} data-motion={reduced ? 'off' : 'on'}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`}>
          <span
            className={reduced ? undefined : 'fx-blur-word'}
            style={{ '--fx-i': i } as CSSProperties}
          >
            {word}
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}
