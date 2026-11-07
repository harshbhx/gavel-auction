import type { Metadata } from 'next';
import { Banner } from 'fumadocs-ui/components/banner';
import { Provider } from '@/components/provider';
import { archivo, martian, newsreader } from '@/lib/fonts';
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
  openGraph: {
    title: 'GAVEL docs',
    description:
      'Every bid is a PayPal hold; only the winner pays. What is proven on the PayPal sandbox, and what is not.',
    images: '/og/site/image.png',
  },
  twitter: { card: 'summary_large_image', images: '/og/site/image.png' },
};

// Restores the Floodlight (projector) choice before first paint. Daylight and Dusk are
// handled by next-themes; Floodlight is a flag on top of Dusk.
const floodlightScript =
  "try{if(localStorage.getItem('gavel-floodlight')==='1'){document.documentElement.dataset.floodlight='1';document.documentElement.classList.add('dark')}}catch(e){}";

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${martian.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: floodlightScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="hl-skip">
          Skip to content
        </a>
        <Provider>
          <Banner
            height="2.25rem"
            className="hl-hatch-fill border-b border-[var(--hl-signal-ink)] bg-[var(--hl-panel)] text-[var(--hl-fg)]"
          >
            <p className="bg-[color-mix(in_oklab,var(--hl-panel)_88%,transparent)] px-4 py-1 text-center font-mono text-[0.68rem] font-bold tracking-wide uppercase sm:text-xs">
              PayPal sandbox only. No real money moves.
            </p>
          </Banner>
          <div id="main" className="flex flex-1 flex-col">
            {children}
          </div>
        </Provider>
      </body>
    </html>
  );
}
