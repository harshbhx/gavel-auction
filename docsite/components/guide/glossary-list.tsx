import Link from 'next/link';
import { glossary, glossaryById } from '@/lib/glossary';
import { siteIndex } from '@/lib/site-index';

// The glossary page body. Entries come from content/glossary.json; the "Used on" lists are built
// from the <Term> marks found in the MDX files at build time (lib/site-index.ts).
export function GlossaryList() {
  const { termUsage } = siteIndex();
  const entries = [...glossary].sort((a, b) =>
    a.term.replace(/[^a-z0-9]/gi, '').localeCompare(b.term.replace(/[^a-z0-9]/gi, ''), 'en', { sensitivity: 'base' }),
  );
  const letters = [...new Set(entries.map((e) => e.term.replace(/[^a-z0-9]/gi, '')[0]?.toUpperCase() ?? '#'))];
  let lastLetter = '';
  return (
    <div className="not-prose">
      <nav aria-label="Jump to letter" className="hl-gloss__letters">
        {letters.map((l) => (
          <a key={l} href={`#letter-${l}`}>
            {l}
          </a>
        ))}
      </nav>
      <dl className="hl-gloss">
        {entries.map((e) => {
          const letter = e.term.replace(/[^a-z0-9]/gi, '')[0]?.toUpperCase() ?? '#';
          const showLetter = letter !== lastLetter;
          lastLetter = letter;
          const used = termUsage.get(e.id) ?? [];
          const page = siteIndex().pages.get(e.page);
          return (
            <div key={e.id} id={showLetter ? `letter-${letter}` : undefined} className="hl-gloss__entry" data-letter={showLetter ? letter : undefined}>
              <dt id={e.id} className="hl-gloss__term">
                <a href={`#${e.id}`} className="hl-gloss__anchor" aria-label={`Link to ${e.term}`}>
                  {e.term}
                </a>
              </dt>
              <dd className="hl-gloss__def">
                <p>{e.short}</p>
                {e.long && <p>{e.long}</p>}
                <p className="hl-gloss__meta">
                  {page && (
                    <>
                      <span className="hl-eyebrow">Explained in</span>{' '}
                      <Link href={e.page}>{page.title}</Link>
                    </>
                  )}
                </p>
                {e.see.length > 0 && (
                  <p className="hl-gloss__meta">
                    <span className="hl-eyebrow">See also</span>{' '}
                    {e.see.map((s, i) => (
                      <span key={s}>
                        {i > 0 && ', '}
                        <a href={`#${s}`}>{glossaryById[s]?.term ?? s}</a>
                      </span>
                    ))}
                  </p>
                )}
                {used.length > 0 && (
                  <details className="hl-gloss__used">
                    <summary>
                      Used on {used.length} {used.length === 1 ? 'page' : 'pages'}
                    </summary>
                    <ul>
                      {used.map((u) => (
                        <li key={u.url}>
                          <Link href={u.url}>{u.title}</Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
