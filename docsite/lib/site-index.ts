import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Build-time index of the docs content, read straight from the .mdx files (the static export
// builds in Node, so this runs once per build). It feeds two kinds of backlinks, so nobody has to
// maintain them by hand:
//   - termUsage:  for each glossary id, the pages that mark it with <Term id="...">;
//   - linkedFrom: for each page, the pages that link to it with a [text](/docs/...) link or a
//                 href="/docs/..." / href: '/docs/...' attribute.
const docsDir = join(process.cwd(), 'content/docs');

export type PageRef = { url: string; title: string };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function urlOf(file: string): string {
  const parts = relative(docsDir, file)
    .replace(/\.mdx$/, '')
    .split('/')
    .filter((s) => !/^\(.*\)$/.test(s));
  if (parts[parts.length - 1] === 'index') parts.pop();
  return '/docs' + (parts.length ? '/' + parts.join('/') : '');
}

function titleOf(src: string, fallback: string): string {
  const m = /^---\n(?:[\s\S]*?\n)?title:\s*(.+?)\s*\n[\s\S]*?---/.exec(src);
  return m ? m[1].replace(/^["']|["']$/g, '') : fallback;
}

type Index = {
  pages: Map<string, PageRef>;
  termUsage: Map<string, PageRef[]>;
  linkedFrom: Map<string, PageRef[]>;
  termsOn: Map<string, string[]>;
};

let cache: Index | undefined;

export function siteIndex(): Index {
  if (cache) return cache;
  const files = walk(docsDir).filter((f) => f.endsWith('.mdx'));
  const pages = new Map<string, PageRef>();
  const sources = new Map<string, string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const url = urlOf(f);
    pages.set(url, { url, title: titleOf(src, url) });
    sources.set(url, src);
  }

  const termUsage = new Map<string, PageRef[]>();
  const termsOn = new Map<string, string[]>();
  const linkedFrom = new Map<string, PageRef[]>();
  const push = (m: Map<string, PageRef[]>, key: string, ref: PageRef) => {
    const list = m.get(key) ?? [];
    if (!list.some((r) => r.url === ref.url)) list.push(ref);
    m.set(key, list);
  };

  for (const [url, src] of sources) {
    const ref = pages.get(url)!;
    for (const m of src.matchAll(/<Term\s+id="([^"]+)"/g)) {
      push(termUsage, m[1], ref);
      const on = termsOn.get(url) ?? [];
      if (!on.includes(m[1])) on.push(m[1]);
      termsOn.set(url, on);
    }
    const targets = [
      ...[...src.matchAll(/\]\((\/docs[^)\s#]*)/g)].map((m) => m[1]),
      ...[...src.matchAll(/href[=:]\s*\{?\s*["'](\/docs[^"'#]*)/g)].map((m) => m[1]),
    ];
    for (const raw of targets) {
      const target = raw.replace(/\/$/, '') || '/docs';
      if (target !== url && pages.has(target)) push(linkedFrom, target, ref);
    }
  }
  for (const m of [termUsage, linkedFrom]) {
    for (const list of m.values()) list.sort((a, b) => a.title.localeCompare(b.title));
  }
  cache = { pages, termUsage, linkedFrom, termsOn };
  return cache;
}
