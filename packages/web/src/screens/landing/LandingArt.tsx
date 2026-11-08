import { t } from '../../copy/t';

/** Small inline illustrations for the three steps. Pure SVG, coloured by tokens in landing.css. */

export function HoldArt() {
  return (
    <svg
      className="gv-art"
      viewBox="0 0 120 72"
      role="img"
      aria-label={t('mk.how.art1')}
      focusable="false"
    >
      <defs>
        <pattern
          id="gv-art-hatch"
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="2" height="7" className="gv-art__held-fill" />
        </pattern>
      </defs>
      <rect x="6" y="6" width="108" height="60" rx="3" className="gv-art__card" />
      <rect x="14" y="14" width="40" height="5" className="gv-art__ink" />
      <rect x="14" y="24" width="64" height="4" className="gv-art__muted" />
      <rect x="14" y="40" width="92" height="18" className="gv-art__hatched" />
    </svg>
  );
}

export function VoiceArt() {
  return (
    <svg
      className="gv-art"
      viewBox="0 0 120 72"
      role="img"
      aria-label={t('mk.how.art2')}
      focusable="false"
    >
      <rect x="6" y="6" width="108" height="60" rx="3" className="gv-art__card" />
      <rect x="20" y="14" width="14" height="26" rx="7" className="gv-art__line" />
      <path d="M14 34a13 13 0 0 0 26 0" className="gv-art__line" />
      <path d="M27 47v8" className="gv-art__line" />
      <circle cx="62" cy="34" r="11" className="gv-art__line" />
      <circle cx="62" cy="34" r="4" className="gv-art__ink-fill" />
      <rect x="82" y="26" width="26" height="16" rx="3" className="gv-art__action" />
      <path d="M89 34l4 4 8-8" className="gv-art__tick" />
    </svg>
  );
}

export function HammerArt() {
  return (
    <svg
      className="gv-art"
      viewBox="0 0 120 72"
      role="img"
      aria-label={t('mk.how.art3')}
      focusable="false"
    >
      <rect x="6" y="6" width="108" height="60" rx="3" className="gv-art__card" />
      <g transform="rotate(-30 40 24)">
        <rect x="26" y="12" width="28" height="12" rx="2" className="gv-art__ink-fill" />
        <rect x="38" y="24" width="4" height="22" className="gv-art__ink-fill" />
      </g>
      <rect x="62" y="16" width="44" height="14" className="gv-art__solid" />
      <rect x="62" y="38" width="44" height="14" className="gv-art__hollow" />
    </svg>
  );
}
