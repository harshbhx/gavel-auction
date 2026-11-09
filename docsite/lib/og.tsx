import { ImageResponse } from 'next/og';

// Open Graph card with the site's identity: cream or dusk ground, the GAVEL wordmark, a
// hatched stripe on the left, and the three-fill rule along the bottom. Drawn with plain divs
// because the image renderer has no access to CSS variables or the page fonts.
const INK = '#121715';
const BRASS = '#7a4600';
const GO = '#0b6b3a';
const BG = '#f6f4ee';

function Letters() {
  // The Mallet G wordmark (brand/svg/wordmark-color.svg) in the app's ink and signal orange.
  return (
    <svg width="360" height="80" viewBox="0 0 452 100" fill={INK}>
      <path d="M80.1 22.9A40.5 40.5 0 1 0 90.5 50" fill="none" stroke={INK} strokeWidth="19" />
      <rect x="41" y="44.5" width="59" height="11" />
      <rect x="34" y="35" width="14" height="30" rx="3" fill="#ff6a1f" />
      <path transform="translate(112 0)" d="M0 100L39.5 0L56.5 0L96 100L77 100L67.52 76L28.48 76L19 100ZM48 26.58L61.2 60L34.8 60Z" fillRule="evenodd" />
      <path transform="translate(206 0)" d="M0 0L19 0L48 73.42L77 0L96 0L56.5 100L39.5 100Z" />
      <path transform="translate(316 0)" d="M0 0L64 0L64 16L19 16L19 42L56 42L56 58L19 58L19 84L64 84L64 100L0 100Z" />
      <path transform="translate(394 0)" d="M0 0L19 0L19 84L58 84L58 100L0 100Z" />
    </svg>
  );
}

export function ogImage({ title, description, kicker }: { title: string; description?: string; kicker: string }) {
  const stripe =
    'repeating-linear-gradient(45deg, #7a4600 0px, #7a4600 3px, #f6f4ee 3px, #f6f4ee 10px)';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: BG, color: INK }}>
        <div style={{ width: 56, height: '100%', display: 'flex', backgroundImage: stripe, borderRight: `3px solid ${BRASS}` }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 64px 0 64px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Letters />
            <div style={{ display: 'flex', fontSize: 22, letterSpacing: 2, color: BRASS, fontWeight: 700 }}>
              {kicker.toUpperCase()}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: title.length > 40 ? 64 : 80, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1 }}>
              {title}
            </div>
            {description ? (
              <div style={{ display: 'flex', marginTop: 24, fontSize: 30, lineHeight: 1.3, color: '#4a524f', maxWidth: 940 }}>
                {description.length > 150 ? `${description.slice(0, 147)}...` : description}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 20, color: '#4a524f', marginBottom: 14 }}>
              PayPal sandbox only. No real money moves.
            </div>
            <div style={{ display: 'flex', height: 18 }}>
              <div style={{ flex: 2, display: 'flex', backgroundImage: stripe, border: `2px solid ${BRASS}` }} />
              <div style={{ flex: 2, display: 'flex', background: GO }} />
              <div style={{ flex: 1, display: 'flex', border: '2px solid #6b726f' }} />
            </div>
            <div style={{ display: 'flex', height: 28 }} />
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
