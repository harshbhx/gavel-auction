import { ImageResponse } from 'next/og';

// Open Graph card with the site's identity: cream or dusk ground, the GAVEL block letters, a
// hatched stripe on the left, and the three-fill rule along the bottom. Drawn with plain divs
// because the image renderer has no access to CSS variables or the page fonts.
const INK = '#121715';
const BRASS = '#7a4600';
const GO = '#0b6b3a';
const BG = '#f6f4ee';

function Letters() {
  return (
    <svg width="300" height="88" viewBox="0 0 150 44" fill="none" stroke={INK} strokeWidth="6.5" strokeLinejoin="miter">
      <path d="M27 9 H8 V29 H27 V19 H16" />
      <path d="M34 32 L48 4 L62 32 M39.5 23 H56.5" />
      <path d="M66 4 L80 32 L94 4" />
      <path d="M117 6 H99 V30 H117 M99 18 H113" />
      <path d="M126 4 V30 H146" />
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
