// Builds plain-HTTP request samples (curl, TypeScript, Python, C#) for one operation, from the
// spec. They call the HTTP API directly; they are not calls to the generated SDKs.
import { deref, type J, type Operation, type Spec } from '@/lib/openapi';
import { exampleOf } from './schema';

export type Sample = { id: string; label: string; code: string };

const ENV: Record<string, string> = {
  adminKey: 'ADMIN_KEY',
  auctioneerAuth: 'AUCTIONEER_TOKEN',
  screenAuth: 'SCREEN_TOKEN',
  sessionAuth: 'SESSION_TOKEN',
  receiptAuth: 'RECEIPT_TOKEN',
  reviewerAuth: 'REVIEWER_TOKEN',
  judgeKey: 'JUDGE_KEY',
};

function headerOf(spec: Spec, o: Operation): { name: string; env: string; value: (v: string) => string } | undefined {
  const sec: J[] | undefined = o.op.security ?? spec.root.security;
  const first = sec?.find((r) => Object.keys(r).length > 0);
  if (!first) return undefined;
  const scheme = Object.keys(first)[0];
  const s = spec.schemes[scheme] ?? {};
  const env = ENV[scheme] ?? scheme.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  if (s.type === 'apiKey') return { name: s.name, env, value: (v) => v };
  return { name: 'Authorization', env, value: (v) => `Bearer ${v}` };
}

function sampleValue(spec: Spec, p: J): string {
  const s = deref(spec.root, p.schema) ?? {};
  const v = p.example ?? s.example ?? s.default ?? (s.enum ? s.enum[0] : undefined);
  return v === undefined ? `<${p.name}>` : String(v);
}

export function samplesFor(spec: Spec, o: Operation): Sample[] {
  const base = spec.servers[0]?.url ?? 'https://api.gavel.dualmindlab.tech';
  const params: J[] = (o.op.parameters ?? []).map((p: J) => deref(spec.root, p)).filter(Boolean);
  let path = o.path;
  for (const p of params.filter((x) => x.in === 'path')) path = path.replace(`{${p.name}}`, sampleValue(spec, p));
  const query = params.filter((x) => x.in === 'query' && x.required).map((p) => `${p.name}=${encodeURIComponent(sampleValue(spec, p))}`);
  const url = `${base}${path}${query.length ? `?${query.join('&')}` : ''}`;
  const method = o.method.toUpperCase();
  const auth = headerOf(spec, o);
  const body = o.op.requestBody ? deref(spec.root, o.op.requestBody) : undefined;
  const json = body?.content?.['application/json'];
  const ex = json ? exampleOf(spec.root, json) : undefined;
  const text = ex !== undefined ? JSON.stringify(ex, null, 2) : undefined;

  const curl = [`curl -X ${method} '${url}'`];
  if (auth) curl.push(`  -H '${auth.name}: ${auth.value(`$${auth.env}`)}'`);
  if (json) curl.push(`  -H 'content-type: application/json'`);
  if (text) curl.push(`  -d '${JSON.stringify(ex)}'`);

  const tsHeaders: string[] = [];
  if (auth) {
    const v = auth.name === 'Authorization' ? '`Bearer ${process.env.' + auth.env + '}`' : 'process.env.' + auth.env + '!';
    tsHeaders.push(`    ${JSON.stringify(auth.name)}: ${v},`);
  }
  if (json) tsHeaders.push(`    "content-type": "application/json",`);
  const ts = [
    `const res = await fetch(${JSON.stringify(url)}, {`,
    `  method: "${method}",`,
    ...(tsHeaders.length ? ['  headers: {', ...tsHeaders, '  },'] : []),
    ...(text ? [`  body: JSON.stringify(${text.replace(/\n/g, '\n  ')}),`] : []),
    `});`,
    `console.log(res.status, await res.json());`,
  ];

  const pyHeaders: string[] = [];
  if (auth) {
    const v = auth.name === 'Authorization' ? `f"Bearer {os.environ['${auth.env}']}"` : `os.environ['${auth.env}']`;
    pyHeaders.push(`        ${JSON.stringify(auth.name)}: ${v},`);
  }
  const py = [
    'import os',
    'import requests',
    '',
    `res = requests.request(`,
    `    "${method}",`,
    `    ${JSON.stringify(url)},`,
    ...(pyHeaders.length ? ['    headers={', ...pyHeaders, '    },'] : []),
    ...(text ? [`    json=${text.replace(/\n/g, '\n    ').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')},`] : []),
    `    timeout=30,`,
    `)`,
    `print(res.status_code, res.text)`,
  ];

  const csMethod = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete' }[method] ?? 'Post';
  const cs = [
    'using System.Net.Http;',
    'using System.Net.Http.Headers;',
    'using System.Text;',
    '',
    'var http = new HttpClient();',
    `var req = new HttpRequestMessage(HttpMethod.${csMethod}, ${JSON.stringify(url)});`,
    ...(auth
      ? [
          auth.name === 'Authorization'
            ? `req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Environment.GetEnvironmentVariable("${auth.env}"));`
            : `req.Headers.Add(${JSON.stringify(auth.name)}, Environment.GetEnvironmentVariable("${auth.env}"));`,
        ]
      : []),
    ...(text ? [`req.Content = new StringContent(${JSON.stringify(JSON.stringify(ex))}, Encoding.UTF8, "application/json");`] : []),
    'var res = await http.SendAsync(req);',
    'Console.WriteLine($"{(int)res.StatusCode} {await res.Content.ReadAsStringAsync()}");',
  ];

  return [
    { id: 'curl', label: 'curl', code: curl.join(' \\\n') },
    { id: 'ts', label: 'TypeScript', code: ts.join('\n') },
    { id: 'py', label: 'Python', code: py.join('\n') },
    { id: 'cs', label: 'C#', code: cs.join('\n') },
  ];
}
