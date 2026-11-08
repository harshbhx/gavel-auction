import { cn } from '@/lib/cn';

/**
 * GAVEL wordmark, The Mallet G (brand/svg/wordmark-color.svg): a heavy circular G whose crossbar is
 * a mallet handle ending in an orange head, then wide monoline AVEL. Outlined paths, no font.
 * Ink is currentColor and the mallet head is the signal fill, so it follows all three themes.
 */
export function Wordmark({ className, title = 'GAVEL' }: { className?: string; title?: string }) {
  return (
    <span className={cn('inline-flex items-center', className)}>
      <svg
        viewBox="0 0 452 100"
        role="img"
        aria-label={title}
        className="h-6 w-auto overflow-visible"
        fill="currentColor"
      >
        <path
          d="M80.10 22.90A40.5 40.5 0 1 0 90.50 50.00"
          fill="none"
          stroke="currentColor"
          strokeWidth="19"
        />
        <rect x="41" y="44.5" width="59" height="11" />
        <rect x="34" y="35" width="14" height="30" rx="3" fill="var(--hl-signal)" />
        <path
          transform="translate(112 0)"
          fillRule="evenodd"
          d="M0 100L39.5 0L56.5 0L96 100L77 100L67.52 76L28.48 76L19 100ZM48 26.58L61.2 60L34.8 60Z"
        />
        <path transform="translate(206 0)" d="M0 0L19 0L48 73.42L77 0L96 0L56.5 100L39.5 100Z" />
        <path
          transform="translate(316 0)"
          d="M0 0L64 0L64 16L19 16L19 42L56 42L56 58L19 58L19 84L64 84L64 100L0 100Z"
        />
        <path transform="translate(394 0)" d="M0 0L19 0L19 84L58 84L58 100L0 100Z" />
      </svg>
    </span>
  );
}
