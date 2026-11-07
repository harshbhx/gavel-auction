/**
 * ShinyText from React Bits by David Haz (https://reactbits.dev, MIT + Commons Clause).
 * Source: https://github.com/DavidHDev/react-bits (ShinyText-TS-TW).
 * Trimmed for the GAVEL docsite to the original CSS-only version: a highlight band sweeps across
 * the text. Stops under prefers-reduced-motion. No client JavaScript.
 */
import type { ReactNode } from 'react';
import { cn } from '../cn';

export default function ShinyText({
  children,
  className,
  speed = 3,
}: {
  children: ReactNode;
  className?: string;
  speed?: number;
}) {
  return (
    <span
      className={cn(
        'inline-block bg-clip-text text-transparent motion-safe:animate-[shiny-text_var(--shiny-speed)_linear_infinite]',
        className,
      )}
      style={
        {
          '--shiny-speed': `${speed}s`,
          backgroundImage:
            'linear-gradient(120deg, var(--color-fd-muted-foreground) 40%, var(--color-fd-foreground) 50%, var(--color-fd-muted-foreground) 60%)',
          backgroundSize: '200% 100%',
          backgroundPosition: '100% 0',
        } as React.CSSProperties
      }
    >
      {children}
    </span>
  );
}
