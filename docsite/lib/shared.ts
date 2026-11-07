import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'GAVEL docs';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'harshbhx',
  repo: 'gavel-auction',
  branch: 'main',
};

export const repoUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/**
 * Where the site is published. PLACEHOLDER until the Pages project exists: the site is built
 * with relative links, so nothing depends on this value except absolute metadata (Open Graph).
 * Set NEXT_PUBLIC_SITE_URL in the build to the real address.
 */
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gavel-docs.example.invalid';

/** Link to a page's MDX source on GitHub (`page.path` is relative to content/docs). */
export function getPageEditUrl(path: string) {
  return `${repoUrl}/blob/${gitConfig.branch}/docsite/content/docs/${path}`;
}

/** Link to a file in the repo, for the "Where this lives in the code" lists. */
export function codeUrl(path: string) {
  return `${repoUrl}/blob/${gitConfig.branch}/${path}`;
}

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
