import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { siteUrl } from '@/lib/shared';

export const dynamic = 'force-static';

/** Every docs page plus the home page, so crawlers can find all of them. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl },
    ...source.getPages().map((page) => ({ url: `${siteUrl}${page.url}` })),
  ];
}
