import { cn } from '@/lib/cn';

/** The brand rule as three swatches with words: hatched, solid, hollow. */
export function FillLegend({ className }: { className?: string }) {
  const sw = 'inline-block h-4 w-9 align-middle';
  return (
    <ul className={cn('flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs', className)}>
      <li className="flex items-center gap-2">
        <span className={cn(sw, 'hl-hatch-chip')} aria-hidden />
        <span>
          <b>Hatched</b> means held
        </span>
      </li>
      <li className="flex items-center gap-2">
        <span className={cn(sw, 'hl-solid-chip')} aria-hidden />
        <span>
          <b>Solid</b> means charged
        </span>
      </li>
      <li className="flex items-center gap-2">
        <span className={cn(sw, 'hl-hollow-chip')} aria-hidden />
        <span>
          <b>Hollow</b> means released
        </span>
      </li>
    </ul>
  );
}
