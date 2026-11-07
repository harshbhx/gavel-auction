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
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
        <p className="hl-hatch-chip w-fit rounded-[2px] px-2 py-0.5 font-mono text-xs font-bold uppercase">
          404, released
        </p>
        <h1 className="text-3xl font-bold">This page is not here.</h1>
        <p className="text-fd-muted-foreground">
          Like a hold that was released, the page was removed or never existed. Nothing was charged. Try
          search (Ctrl or Cmd plus K) or start from one of the sections.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <Link
                href={starts[s.id]}
                className="block rounded-[2px] border border-[var(--hl-hairline)] bg-fd-card px-3 py-2 font-mono text-sm font-bold hover:bg-fd-accent"
              >
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </HomeLayout>
  );
}
