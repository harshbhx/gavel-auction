import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * GAVEL wordmark, drawn by hand as paths (no font involved): five block letters with square
 * ends, over a rule that is the product's three fills in one line: hatched (held), solid
 * (charged) and hollow (released). The `A` has no crossbar gap, the `V` is the hammer's
 * wedge. Works at any size; colours come from currentColor and the theme tokens.
 */
export function Wordmark({ className, title = 'GAVEL' }: { className?: string; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <span className={cn('inline-flex items-center', className)}>
      <svg
        viewBox="0 0 150 44"
        role="img"
        aria-label={title}
        className="h-7 w-auto overflow-visible"
        fill="none"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      >
        <defs>
          <pattern id={`${id}h`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="5" fill="var(--hl-signal-ink)" />
          </pattern>
        </defs>
        {/* G */}
        <path d="M27 9 H8 V29 H27 V19 H16" />
        {/* A */}
        <path d="M34 32 L48 4 L62 32 M39.5 23 H56.5" />
        {/* V */}
        <path d="M66 4 L80 32 L94 4" />
        {/* E */}
        <path d="M117 6 H99 V30 H117 M99 18 H113" />
        {/* L */}
        <path d="M126 4 V30 H146" />
        {/* the three fills as a rule */}
        <g strokeWidth="1.5">
          <rect x="3" y="37" width="58" height="5" fill={`url(#${id}h)`} stroke="var(--hl-signal-ink)" />
          <rect x="61" y="37" width="58" height="5" fill="var(--hl-go)" stroke="var(--hl-go)" />
          <rect x="119" y="37" width="28" height="5" fill="none" stroke="var(--hl-border)" />
        </g>
      </svg>
    </span>
  );
}
