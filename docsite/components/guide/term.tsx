import type { ReactNode } from 'react';
import { glossaryById, glossaryHref } from '@/lib/glossary';
import { TermPopover } from './term-popover';

// <Term id="hold">hold</Term> in any .mdx page. The definition comes from content/glossary.json;
// an unknown id fails the build, so a tooltip can never point at nothing.
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const entry = glossaryById[id];
  if (!entry) throw new Error(`<Term id="${id}">: no such glossary entry (content/glossary.json)`);
  return (
    <TermPopover term={entry.term} short={entry.short} href={glossaryHref(id)}>
      {children ?? entry.term}
    </TermPopover>
  );
}
