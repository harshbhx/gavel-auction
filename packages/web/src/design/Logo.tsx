import './logo.css';

export type LogoVariant = 'mark' | 'wordmark' | 'lockup';

export interface LogoProps {
  /** mark: the Mallet G alone. wordmark: G plus AVEL. lockup: the mark beside the wordmark. */
  variant?: LogoVariant;
  /** Rendered height in CSS pixels. The width follows the artwork's aspect ratio, so nothing shifts. */
  height?: number;
  /** True when text beside the logo already says GAVEL (hides it from assistive technology). */
  decorative?: boolean;
  /**
   * Optional motion: the mallet winds up and strikes with a smooth ease, on hover or focus
   * ('hover'), once when the logo mounts ('load'), or both. Off by default and always off under
   * prefers-reduced-motion.
   */
  motion?: 'hover' | 'load' | 'both';
  className?: string;
}

/** Artwork box of each variant (brand/svg, 100 units tall). */
const BOX: Record<LogoVariant, readonly [number, number]> = {
  mark: [100, 100],
  wordmark: [452, 100],
  lockup: [406.24, 100],
};

const MARK = (
  <>
    <path
      className="gv-logo__stroke"
      d="M78.98 23.90A39 39 0 1 0 89.00 50.00"
      fill="none"
      strokeWidth="22"
    />
    <g className="gv-logo__mallet">
      <rect className="gv-logo__ink" x="40" y="43.5" width="60" height="13" />
      <rect className="gv-logo__head" x="32" y="33" width="16" height="34" rx="3" />
    </g>
  </>
);

const WORD = (
  <>
    <path
      className="gv-logo__stroke"
      d="M80.10 22.90A40.5 40.5 0 1 0 90.50 50.00"
      fill="none"
      strokeWidth="19"
    />
    <g className="gv-logo__mallet">
      <rect className="gv-logo__ink" x="41" y="44.5" width="59" height="11" />
      <rect className="gv-logo__head" x="34" y="35" width="14" height="30" rx="3" />
    </g>
    <path
      className="gv-logo__ink"
      fillRule="evenodd"
      transform="translate(112 0)"
      d="M0 100L39.5 0L56.5 0L96 100L77 100L67.52 76L28.48 76L19 100ZM48 26.58L61.2 60L34.8 60Z"
    />
    <path
      className="gv-logo__ink"
      transform="translate(206 0)"
      d="M0 0L19 0L48 73.42L77 0L96 0L56.5 100L39.5 100Z"
    />
    <path
      className="gv-logo__ink"
      transform="translate(316 0)"
      d="M0 0L64 0L64 16L19 16L19 42L56 42L56 58L19 58L19 84L64 84L64 100L0 100Z"
    />
    <path
      className="gv-logo__ink"
      transform="translate(394 0)"
      d="M0 0L19 0L19 84L58 84L58 100L0 100Z"
    />
  </>
);

/**
 * The GAVEL logo, The Mallet G, as inline SVG. Ink follows the theme foreground and the mallet head
 * follows the action colour, so it matches paper, dark and projector themes. Outlined paths: no font.
 */
export function Logo({
  variant = 'wordmark',
  height = 24,
  decorative = false,
  motion,
  className,
}: LogoProps) {
  const [w, h] = BOX[variant];
  const width = Math.round((height * w) / h);
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': 'GAVEL' } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width={width}
      height={height}
      focusable="false"
      className={[
        'gv-logo',
        motion === 'hover' || motion === 'both' ? 'gv-logo--hover' : '',
        motion === 'load' || motion === 'both' ? 'gv-logo--load' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...a11y}
    >
      {variant === 'mark' && MARK}
      {variant === 'wordmark' && WORD}
      {variant === 'lockup' && (
        <>
          {MARK}
          <g transform="translate(126 19) scale(0.62)">{WORD}</g>
        </>
      )}
    </svg>
  );
}
