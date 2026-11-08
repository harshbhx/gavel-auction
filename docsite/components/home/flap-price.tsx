import { cn } from '@/lib/cn';

/**
 * The split-flap price from the web app's scoreboard, drawn in plain CSS: one tile per digit
 * with a hinge line across the middle. Static on purpose; the number is an example, and the
 * accessible name says so, so screen readers hear one phrase instead of seven tiles.
 */
export function FlapPrice({
  cents,
  label,
  className,
}: {
  cents: number;
  label: string;
  className?: string;
}) {
  const dollars = Math.floor(cents / 100).toString();
  const rest = (cents % 100).toString().padStart(2, '0');
  const chars = ['$', ...dollars.split(''), '.', ...rest.split('')];
  return (
    <div role="img" aria-label={label} className={cn('hl-flap', className)}>
      {chars.map((c, i) =>
        c === '.' || c === '$' ? (
          <span key={i} className="hl-flap__mark" aria-hidden>
            {c}
          </span>
        ) : (
          <span key={i} className="hl-flap__tile" aria-hidden>
            {c}
          </span>
        ),
      )}
    </div>
  );
}
