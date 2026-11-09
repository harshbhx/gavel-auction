import { deref, refName, type J } from '@/lib/openapi';

type Row = {
  name: string;
  depth: number;
  type: string;
  required: boolean;
  description: string;
  extra: string;
};

function typeOf(root: J, s: J): string {
  if (!s) return 'any';
  if (s.$ref) return refName(s.$ref);
  if (s.oneOf || s.anyOf) return (s.oneOf ?? s.anyOf).map((x: J) => typeOf(root, x)).join(' | ');
  if (s.allOf) return s.allOf.map((x: J) => typeOf(root, x)).join(' + ');
  if (s.const !== undefined) return `const ${JSON.stringify(s.const)}`;
  const t = Array.isArray(s.type) ? s.type.join(' | ') : (s.type ?? 'object');
  if (t === 'array') return `array of ${typeOf(root, s.items)}`;
  return s.format ? `${t} (${s.format})` : t;
}

function extraOf(s: J): string {
  const bits: string[] = [];
  if (s.enum) bits.push(`one of ${s.enum.map((v: unknown) => JSON.stringify(v)).join(', ')}`);
  if (s.minimum !== undefined) bits.push(`min ${s.minimum}`);
  if (s.maximum !== undefined) bits.push(`max ${s.maximum}`);
  if (s.minLength !== undefined) bits.push(`min length ${s.minLength}`);
  if (s.maxLength !== undefined) bits.push(`max length ${s.maxLength}`);
  if (s.pattern) bits.push(`pattern ${s.pattern}`);
  if (s.default !== undefined) bits.push(`default ${JSON.stringify(s.default)}`);
  return bits.join('; ');
}

function collect(root: J, schema: J, depth: number, seen: string[], rows: Row[]): void {
  const s = deref(root, schema);
  if (!s || typeof s !== 'object') return;
  const variants: J[] = s.allOf ?? [];
  for (const v of variants) collect(root, v, depth, seen, rows);
  const props: Record<string, J> = s.properties ?? {};
  const req: string[] = s.required ?? [];
  for (const [name, raw] of Object.entries(props)) {
    const p = deref(root, raw) ?? {};
    rows.push({
      name,
      depth,
      type: typeOf(root, raw),
      required: req.includes(name),
      description: p.description ?? (raw.description as string | undefined) ?? '',
      extra: extraOf(p),
    });
    const key: string | undefined = raw.$ref ?? raw.items?.$ref;
    if (depth >= 3 || (key && seen.includes(key))) continue;
    const next = seen.concat(key ? [key] : []);
    if (p.properties || p.allOf) collect(root, raw, depth + 1, next, rows);
    else if (p.items) {
      const it = deref(root, p.items);
      if (it && (it.properties || it.allOf)) collect(root, p.items, depth + 1, next, rows);
    }
  }
}

/** Field table for an object schema, nested fields indented. */
export function SchemaTable({ root, schema }: { root: J; schema: J }) {
  const s = deref(root, schema);
  const rows: Row[] = [];
  collect(root, schema, 0, schema?.$ref ? [schema.$ref] : [], rows);
  const head = (
    <p className="text-sm">
      <span className="font-mono">{typeOf(root, schema)}</span>
      {s?.description ? <span className="text-fd-muted-foreground"> {s.description}</span> : null}
    </p>
  );
  if (rows.length === 0) {
    const extra = s ? extraOf(s) : '';
    return (
      <div className="space-y-1">
        {head}
        {extra ? <p className="text-sm text-fd-muted-foreground">{extra}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {head}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-fd-foreground">
              <th scope="col" className="py-1 pr-4 font-semibold">Field</th>
              <th scope="col" className="py-1 pr-4 font-semibold">Type</th>
              <th scope="col" className="py-1 font-semibold">Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-fd-border align-top">
                <td className="py-1 pr-4 font-mono" style={{ paddingLeft: `${r.depth * 1.25}rem` }}>
                  {r.name}
                  {r.required ? <span className="text-fd-muted-foreground"> (required)</span> : null}
                </td>
                <td className="py-1 pr-4 font-mono text-fd-muted-foreground">{r.type}</td>
                <td className="py-1">
                  {r.description}
                  {r.extra ? (
                    <span className="block text-fd-muted-foreground">{r.extra}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** First example of a media type object, from `example`, `examples` or the schema. */
export function exampleOf(root: J, media: J): unknown {
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  if (media.examples) {
    const first = Object.values<J>(media.examples)[0];
    const v = deref(root, first);
    if (v && v.value !== undefined) return v.value;
  }
  const s = deref(root, media.schema);
  return s?.example;
}
