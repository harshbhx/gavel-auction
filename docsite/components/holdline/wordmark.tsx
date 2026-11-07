import { cn } from '@/lib/cn';

/** GAVEL wordmark: condensed heavy Archivo with a brass underline. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-col leading-none', className)}>
      <span className="hl-display text-xl tracking-wide">GAVEL</span>
      <span aria-hidden className="mt-0.5 h-[3px] w-full bg-[var(--hl-signal)]" />
      <span className="sr-only"> docs</span>
    </span>
  );
}
