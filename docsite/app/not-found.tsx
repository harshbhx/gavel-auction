import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { sections } from '@/lib/sections';

export const metadata = { title: 'Page not found' };

const starts: Record<string, string> = {
  learn: '/docs/start',
  prove: '/docs/proof',
  judges: '/docs/judges',
  builders: '/docs/builders',
  operators: '/docs/run',
  reference: '/docs/reference/architecture',
};

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="hl-dots mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
        <p className="hl-eyebrow">Error 404</p>
        <h1 className="hl-display text-[clamp(3.5rem,12vw,8rem)]">Released.</h1>
        {/* a hold that was let go: only the outline is left */}
        <div role="img" aria-label="A hollow bar: a hold that was released" className="hl-hold__bar max-w-md" />
        <p className="max-w-[34rem] font-[family-name:var(--font-newsreader)] text-xl leading-snug">
          This page is gone, or was never here. Like a hold that was released, nothing was charged. Try
          search (Ctrl or Cmd plus K), or start from one of these.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <Link href={starts[s.id]} className="hl-card block px-4 py-3 font-mono text-sm font-bold">
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </HomeLayout>
  );
}
