import type { Metadata, Viewport } from 'next';
import { Banner } from 'fumadocs-ui/components/banner';
import { Provider } from '@/components/provider';
import { bigShoulders, jetbrains, publicSans } from '@/lib/fonts';
import { socialMeta } from '@/lib/meta';
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
  // One canonical host: the alias gavel-docs.dualmindlab.tech serves the same build, so every page
  // names its docs.gavel.dualmindlab.tech URL as canonical (relative to metadataBase).
  alternates: { canonical: './' },
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
  ...socialMeta({
    title: 'GAVEL docs',
    description:
      'Every bid is a PayPal hold; only the winner pays. What is proven on the PayPal sandbox, and what is not.',
    path: '/',
  }),
};

export const viewport: Viewport = { themeColor: '#efe6d3' };

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${bigShoulders.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
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
