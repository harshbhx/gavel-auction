'use client';

/**
 * SpotlightCard from React Bits by David Haz (https://reactbits.dev, MIT + Commons Clause).
 * Source: https://github.com/DavidHDev/react-bits (SpotlightCard-TS-TW).
 * Trimmed for the GAVEL docsite: the spotlight follows the pointer through CSS variables, so moving
 * the mouse never re-renders React. Colors come from the Fumadocs theme tokens.
 */
import { useRef, type HTMLAttributes, type PointerEvent } from 'react';
import { cn } from '../cn';

export type SpotlightCardProps = HTMLAttributes<HTMLDivElement> & {
  spotlightColor?: string;
  spotlightSize?: number;
};

export default function SpotlightCard({
  children,
  className,
  spotlightColor = 'color-mix(in oklab, var(--color-fd-primary) 22%, transparent)',
  spotlightSize = 360,
  onPointerMove,
  ...rest
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
    }
    onPointerMove?.(e);
  };

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      className={cn('group/spot relative isolate overflow-hidden rounded-2xl border bg-fd-card', className)}
      {...rest}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover/spot:opacity-100 group-focus-within/spot:opacity-100 motion-reduce:transition-none"
        style={{
          background: `radial-gradient(${spotlightSize}px circle at var(--spot-x, 50%) var(--spot-y, 0%), ${spotlightColor}, transparent 70%)`,
        }}
      />
      {children}
    </div>
  );
}
