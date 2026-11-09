import type { ReactNode } from 'react';

// The spec writes descriptions in a small Markdown subset: paragraphs, `code`, **bold**, links.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    i += 1;
    if (tok.startsWith('`')) {
      out.push(
        <code key={i} className="font-mono text-[0.9em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      out.push(<strong key={i}>{tok.slice(2, -2)}</strong>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      out.push(
        link ? (
          <a key={i} href={link[2]} className="underline underline-offset-2">
            {link[1]}
          </a>
        ) : (
          tok
        ),
      );
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Prose({ text, className = '' }: { text?: string; className?: string }) {
  if (!text) return null;
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className={`space-y-3 ${className}`}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => l.trim().startsWith('- '))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.trim().slice(2))}</li>
              ))}
            </ul>
          );
        }
        if (lines[0].startsWith('|') && lines.length > 2) {
          const rows = lines
            .filter((l) => !/^\|\s*-+/.test(l))
            .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
          const [head, ...body] = rows;
          return (
            <table key={i} className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-fd-foreground">
                  {head.map((c, j) => (
                    <th key={j} scope="col" className="py-1 pr-4 font-semibold">
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, j) => (
                  <tr key={j} className="border-b border-fd-border align-top">
                    {r.map((c, k) => (
                      <td key={k} className="py-1 pr-4">
                        {inline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (lines[0].startsWith('#')) {
          return (
            <p key={i} className="font-semibold">
              {lines[0].replace(/^#+\s*/, '')}
            </p>
          );
        }
        return <p key={i}>{inline(lines.join(' '))}</p>;
      })}
    </div>
  );
}
