import { codeUrl } from '@/lib/shared';

/** "Where this lives in the code": each path links to the file on GitHub. */
export function CodePaths({ paths }: { paths: Array<string | { path: string; note: string }> }) {
  return (
    <ul className="not-prose my-4 divide-y divide-[var(--hl-hairline)] border border-[var(--hl-hairline)] bg-fd-card">
      {paths.map((p) => {
        const path = typeof p === 'string' ? p : p.path;
        const note = typeof p === 'string' ? null : p.note;
        return (
          <li key={path} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
            <a
              href={codeUrl(path)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[0.8rem] font-medium text-fd-primary underline underline-offset-4"
            >
              {path}
            </a>
            {note && <span className="text-sm text-fd-muted-foreground">{note}</span>}
          </li>
        );
      })}
    </ul>
  );
}
