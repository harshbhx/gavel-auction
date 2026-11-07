import { source } from '@/lib/source';
import { sectionOf } from '@/lib/sections';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

// Every page is indexed with its section as the tag, so the search dialog can filter by
// Learn, Prove, For judges, Builders, Operators or Reference.
export const { staticGET: GET } = createFromSource(source, {
  language: 'english',
  buildIndex: async (page) => ({
    id: page.url,
    title: page.data.title,
    description: page.data.description,
    url: page.url,
    tag: sectionOf(page.slugs),
    structuredData: page.data.structuredData,
  }),
});
