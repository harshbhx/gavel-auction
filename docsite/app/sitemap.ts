import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { siteUrl } from '@/lib/shared';

// The docs site is a static export, so the sitemap is written once at build time.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl.replace(/\/$/, '');
  return [
    { url: `${base}/` },
    ...source.getPages().map((page) => ({ url: `${base}${page.url}` })),
  ];
}
