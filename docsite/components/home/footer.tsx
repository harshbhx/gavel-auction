import Link from 'next/link';
import { repoUrl } from '@/lib/shared';
import { Wordmark } from '@/components/holdline/wordmark';

export function Footer() {
  return (
    <footer className="border-t-2 border-[var(--hl-fg)] px-4 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-start justify-between gap-6">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-sm text-sm text-fd-muted-foreground">
            Built for the PayPal Hackathon 2026. PayPal sandbox only: no real money moves. MIT License.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
          <Link href="/docs/start" className="hover:underline">Start here</Link>
          <Link href="/docs/how-it-works" className="hover:underline">How it works</Link>
          <Link href="/docs/proof" className="hover:underline">Proof</Link>
          <Link href="/docs/judges" className="hover:underline">For judges</Link>
          <Link href="/docs/builders" className="hover:underline">Builders</Link>
          <Link href="/docs/safety" className="hover:underline">Safety</Link>
          <Link href="/docs/run" className="hover:underline">Operators</Link>
          <Link href="/docs/roadmap" className="hover:underline">Roadmap and limits</Link>
          <a href={repoUrl} target="_blank" rel="noreferrer noopener" className="hover:underline">GitHub repository</a>
          <a href="/llms.txt" className="hover:underline">llms.txt</a>
        </nav>
      </div>
    </footer>
  );
}
