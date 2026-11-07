import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import { archivo, martian } from '@/lib/fonts';
import { siteUrl } from '@/lib/shared';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'GAVEL docs',
    template: '%s | GAVEL docs',
  },
  description:
    'Every bid is a PayPal hold; only the winner pays. How GAVEL settles an auction, what has been proven on the PayPal sandbox, and what has not.',
  icons: { icon: '/icon.svg' },
};

// Restores the Floodlight (projector) choice before first paint. Daylight and Dusk are
// handled by next-themes; Floodlight is a flag on top of Dusk.
const floodlightScript =
  "try{if(localStorage.getItem('gavel-floodlight')==='1'){document.documentElement.dataset.floodlight='1';document.documentElement.classList.add('dark')}}catch(e){}";

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${martian.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: floodlightScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="hl-skip">
          Skip to content
        </a>
        <div
          role="note"
          className="hl-hatch-fill border-b border-[var(--hl-signal-ink)] bg-[var(--hl-panel)]"
        >
          <p className="bg-[color-mix(in_oklab,var(--hl-panel)_88%,transparent)] px-4 py-1.5 text-center font-mono text-xs font-bold tracking-wide uppercase">
            PayPal sandbox only. No real money moves.
          </p>
        </div>
        <Provider>
          <div id="main" className="flex flex-1 flex-col">
            {children}
          </div>
        </Provider>
      </body>
    </html>
  );
}
