import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/shared';

// The docs site is a static export, so robots.txt is written once at build time.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl.replace(/\/$/, '');
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${base}/sitemap.xml`,
  };
}
