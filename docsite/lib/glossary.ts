import data from '@/content/glossary.json';

// The glossary data lives in content/glossary.json: one file feeds the glossary page and the
// <Term> tooltips. This module only types it and builds lookups.
export type GlossaryEntry = {
  id: string;
  term: string;
  short: string;
  long?: string;
  page: string;
  see: string[];
};

export const glossary: GlossaryEntry[] = data.entries;

export const glossaryById: Record<string, GlossaryEntry> = Object.fromEntries(
  glossary.map((e) => [e.id, e]),
);

export const glossaryHref = (id: string) => `/docs/reference/glossary#${id}`;
