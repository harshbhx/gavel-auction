import Link from 'next/link';
import { glossaryById, glossaryHref } from '@/lib/glossary';
import { related } from '@/lib/related';
import { siteIndex, type PageRef } from '@/lib/site-index';

// The end of every docs page: Related (hand-picked, else folder siblings), Linked from (generated
// backlinks) and Terms on this page (generated from the <Term> marks).
export function PageFooter({ url }: { url: string }) {
  const { pages, linkedFrom, termsOn } = siteIndex();

  const picked = related[url];
  let rel: PageRef[] = [];
  if (picked) {
    rel = picked.map((u) => {
      const p = pages.get(u);
      if (!p) throw new Error(`lib/related.ts: ${url} lists ${u}, which is not a docs page`);
      return p;
    });
  } else {
    const dir = url.replace(/\/[^/]+$/, '');
    rel = [...pages.values()]
      .filter((p) => p.url !== url && p.url !== dir && p.url.startsWith(dir + '/') && !p.url.slice(dir.length + 1).includes('/'))
      .slice(0, 4);
  }
  const back = (linkedFrom.get(url) ?? []).filter((p) => !rel.some((r) => r.url === p.url)).slice(0, 8);
  const terms = (termsOn.get(url) ?? []).filter((id) => glossaryById[id]);

  if (!rel.length && !back.length && !terms.length) return null;
  return (
    <aside aria-label="Related" className="hl-related not-prose mt-12 border-t border-[var(--hl-hairline)] pt-6">
      {rel.length > 0 && (
        <section>
          <h2 className="hl-related__h">Related</h2>
          <ul className="hl-related__list">
            {rel.map((p) => (
              <li key={p.url}>
                <Link href={p.url}>{p.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {back.length > 0 && (
        <section>
          <h2 className="hl-related__h">Linked from</h2>
          <ul className="hl-related__list">
            {back.map((p) => (
              <li key={p.url}>
                <Link href={p.url}>{p.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {terms.length > 0 && (
        <section>
          <h2 className="hl-related__h">Terms on this page</h2>
          <ul className="hl-related__terms">
            {terms.map((id) => (
              <li key={id}>
                <Link href={glossaryHref(id)}>{glossaryById[id].term}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
