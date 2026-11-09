import { deref, refName, type J, type Operation, type Spec } from '@/lib/openapi';
import { Prose } from './text';
import { SchemaTable, exampleOf } from './schema';

function Code({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="overflow-x-auto border border-fd-border bg-fd-muted p-3 font-mono text-xs leading-relaxed" tabIndex={0}>
      <code>{text}</code>
    </pre>
  );
}

function H4({ children }: { children: string }) {
  return <h4 className="mt-6 mb-2 text-xs font-bold tracking-wide uppercase">{children}</h4>;
}

function Security({ spec, op }: { spec: Spec; op: J }) {
  const sec: J[] | undefined = op.security ?? spec.root.security;
  if (!sec || sec.length === 0) {
    return <p className="text-sm">No credential needed.</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {sec.map((req: J, i: number) => {
        const names = Object.keys(req);
        if (names.length === 0) return <li key={i}>No credential needed.</li>;
        return (
          <li key={i}>
            {names.map((n, j) => {
              const sc = spec.schemes[n] ?? {};
              const how =
                sc.type === 'apiKey' ? `header ${sc.name}` : sc.scheme === 'bearer' ? 'Authorization: Bearer' : sc.type;
              return (
                <span key={n}>
                  {j > 0 ? ' and ' : ''}
                  <span className="font-mono">{n}</span> <span className="text-fd-muted-foreground">({how})</span>
                </span>
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}

export function OperationView({ spec, o }: { spec: Spec; o: Operation }) {
  const { op } = o;
  const params: J[] = (op.parameters ?? []).map((p: J) => deref(spec.root, p)).filter(Boolean);
  const body = op.requestBody ? deref(spec.root, op.requestBody) : undefined;
  const responses: [string, J][] = Object.entries<J>(op.responses ?? {}).map(([code, r]) => [code, deref(spec.root, r)]);
  return (
    <article id={o.id} className="scroll-mt-20 border-t border-fd-foreground py-8">
      <h3 className="flex flex-wrap items-baseline gap-x-3 font-mono text-base font-bold">
        <span className="uppercase">{o.method}</span>
        <span className="break-all">{o.path}</span>
      </h3>
      <p className="mt-1 text-lg font-semibold">{op.summary}</p>
      {op.deprecated ? <p className="text-sm font-semibold">Deprecated.</p> : null}
      <Prose text={op.description} className="mt-3 text-sm" />

      <H4>Authentication</H4>
      <Security spec={spec} op={op} />

      {params.length > 0 ? (
        <>
          <H4>Parameters</H4>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Parameters table">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-fd-foreground">
                  <th scope="col" className="py-1 pr-4 font-semibold">Name</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">In</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Type</th>
                  <th scope="col" className="py-1 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                {params.map((p) => {
                  const s = deref(spec.root, p.schema) ?? {};
                  const bits: string[] = [];
                  if (s.enum) bits.push(`one of ${s.enum.join(', ')}`);
                  if (s.minimum !== undefined) bits.push(`min ${s.minimum}`);
                  if (s.maximum !== undefined) bits.push(`max ${s.maximum}`);
                  if (s.default !== undefined) bits.push(`default ${JSON.stringify(s.default)}`);
                  const ex = p.example ?? s.example;
                  if (ex !== undefined) bits.push(`example ${JSON.stringify(ex)}`);
                  return (
                    <tr key={`${p.in}-${p.name}`} className="border-b border-fd-border align-top">
                      <td className="py-1 pr-4 font-mono">
                        {p.name}
                        {p.required ? <span className="text-fd-muted-foreground"> (required)</span> : null}
                      </td>
                      <td className="py-1 pr-4">{p.in}</td>
                      <td className="py-1 pr-4 font-mono text-fd-muted-foreground">
                        {s.$ref ? refName(s.$ref) : (s.type ?? 'string')}
                        {s.format ? ` (${s.format})` : ''}
                      </td>
                      <td className="py-1">
                        {p.description}
                        {bits.length ? <span className="block text-fd-muted-foreground">{bits.join('; ')}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {body ? (
        <>
          <H4>Request body</H4>
          {body.description ? <p className="mb-2 text-sm">{body.description}</p> : null}
          {Object.entries<J>(body.content ?? {}).map(([type, media]) => {
            const ex = exampleOf(spec.root, media);
            return (
              <div key={type} className="mb-4 space-y-3">
                <p className="text-sm">
                  <span className="font-mono">{type}</span>
                  {body.required ? <span className="text-fd-muted-foreground"> (required)</span> : null}
                </p>
                {media.schema ? <SchemaTable root={spec.root} schema={media.schema} /> : null}
                {ex !== undefined ? <Code value={ex} /> : null}
              </div>
            );
          })}
        </>
      ) : null}

      <H4>Responses</H4>
      <div className="space-y-5">
        {responses.map(([code, r]) => {
          const media = Object.entries<J>(r?.content ?? {});
          return (
            <section key={code} aria-label={`Response ${code}`}>
              <p className="text-sm">
                <span className="font-mono font-bold">{code}</span> {r?.description}
              </p>
              {media.map(([type, m]) => {
                const ex = exampleOf(spec.root, m);
                return (
                  <div key={type} className="mt-2 space-y-3">
                    <p className="font-mono text-xs text-fd-muted-foreground">{type}</p>
                    {m.schema && code.startsWith('2') ? <SchemaTable root={spec.root} schema={m.schema} /> : null}
                    {ex !== undefined ? <Code value={ex} /> : null}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </article>
  );
}
