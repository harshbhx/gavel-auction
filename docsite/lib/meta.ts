import type { Metadata } from 'next';

/**
 * Link-preview metadata (Open Graph and Twitter). Next replaces a parent's `openGraph` and `twitter`
 * wholesale when a page sets its own, so every page builds the full set through this one helper and
 * none can lose siteName, type, the image size or the alt text. Paths are relative to metadataBase
 * (https://docs.gavel.dualmindlab.tech, set in app/layout.tsx), so every URL comes out absolute.
 * scripts/check-meta.mjs fails the build when an exported page is missing any of these tags.
 */
export const DEFAULT_OG_IMAGE = '/og/og-docs.png';
export const DEFAULT_OG_ALT =
  'GAVEL documentation: every bid is a hold, the hammer is the payment. PayPal sandbox only. Partners: Render, APIMatic, AG Grid.';

export function socialMeta(input: {
  title: string;
  description: string;
  /** Page path, for og:url. */
  path: string;
  image?: string;
  alt?: string;
  type?: 'website' | 'article';
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const image = input.image ?? DEFAULT_OG_IMAGE;
  const alt = input.alt ?? DEFAULT_OG_ALT;
  return {
    openGraph: {
      type: input.type ?? 'website',
      siteName: 'GAVEL docs',
      locale: 'en_US',
      url: input.path,
      title: input.title,
      description: input.description,
      images: [{ url: image, width: 1200, height: 630, alt, type: 'image/png' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      images: [{ url: image, alt }],
    },
  };
}
