import type { Metadata } from 'next';
import { loadSpec, type J } from '@/lib/openapi';
import { OperationView } from '@/components/api/operation';
import { ApiNav, type NavGroup } from '@/components/api/nav';
import { MethodBadge } from '@/components/api/method-badge';
import { Prose } from '@/components/api/text';
import { socialMeta } from '@/lib/meta';
import { repoUrl } from '@/lib/shared';

export const metadata: Metadata = {
  title: 'API reference',
  description:
    'Every HTTP endpoint of the GAVEL host, grouped by tag, with parameters, request and response schemas, examples, authentication and error codes. Rendered from openapi/gavel.yaml at build time.',
  ...socialMeta({
    title: 'API reference',
    description:
      'Every HTTP endpoint of the GAVEL host with parameters, schemas, examples, authentication and error codes.',
    path: '/api-reference',
  }),
};

const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const sdkRelease = `${repoUrl}/releases/tag/sdk-v0.0.5`;

const statuses: [string, string][] = [
  ['400', 'The request is malformed or breaks a rule. Read `code` and `message`.'],
  ['401', 'The credential is missing, expired or of the wrong kind.'],
  ['403', 'The credential is valid but may not do this.'],
  ['404', 'No such auction, hold or room.'],
  ['409', 'The request conflicts with the current state, for example a bid below the increment.'],
  ['410', 'The thing existed and is gone, for example an ended or expired room.'],
  ['413', 'The body is larger than the host accepts.'],
  ['415', 'The body is not JSON.'],
  ['429', 'Rate limited. Wait the number of seconds in the Retry-After header.'],
  ['500', 'An error on the host.'],
  ['503', 'The host is not ready or is at a capacity limit.'],
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-20 border-t-2 border-fd-foreground pt-4 text-xl font-bold">
      {children}
    </h2>
  );
}

export default function ApiReferencePage() {
  const spec = loadSpec();
  const errorCodes: J = spec.root.components?.schemas?.ErrorCode;
  const extraCodes: J = spec.root.components?.schemas?.ExtraErrorCode;
  const total = spec.groups.reduce((n, g) => n + g.ops.length, 0);
  const nav: NavGroup[] = spec.groups.map((g) => ({
    tag: g.tag,
    slug: slugOf(g.tag),
    ops: g.ops.map((o) => ({ id: o.id, method: o.method, path: o.path, summary: o.op.summary ?? o.path })),
  }));
  const extra = [
    { href: '#overview', label: 'Overview' },
    { href: '#authentication', label: 'Authentication' },
    { href: '#errors', label: 'Errors' },
    { href: '#rate-limits', label: 'Rate limits' },
    { href: '#sdks', label: 'SDKs with APIMatic' },
  ];
  const limits: J = spec.root['x-rate-limits'] ?? {};
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10">
      <header>
        <p className="font-mono text-xs font-bold tracking-wide uppercase text-fd-muted-foreground">
          {spec.info.title}, version {spec.info.version}, OpenAPI 3.1
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">API reference</h1>
        <p className="mt-2 max-w-3xl text-fd-muted-foreground">
          {total} operations in {spec.groups.length} groups, rendered from{' '}
          <a className="underline" href={`${repoUrl}/blob/main/openapi/gavel.yaml`}>openapi/gavel.yaml</a> when this site is built,
          so it matches the spec. PayPal sandbox only: no real money moves.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <a className="underline" href="/openapi.yaml">Download openapi.yaml</a>
          <a className="underline" href="/docs/judges/call-the-api">Call it live as a judge</a>
          <a className="underline" href="/docs/reference/websocket-protocol">WebSocket protocol</a>
          <a className="underline" href="#sdks">SDKs</a>
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <ApiNav groups={nav} extra={extra} />
        <div className="min-w-0">
          <section id="overview" className="scroll-mt-20">
            <h2 className="text-xl font-bold">Overview</h2>
            <div className="mt-3 rounded-[2px] border border-fd-border bg-fd-card p-4">
              <p className="text-xs font-bold tracking-wide uppercase">Base URLs</p>
              <ul className="mt-2 space-y-1 text-sm">
                {spec.servers.map((s: J) => (
                  <li key={s.url}>
                    <span className="font-mono break-all">{s.url}</span>{' '}
                    <span className="text-fd-muted-foreground">{s.description}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Prose text={String(spec.info.description).split('## Authentication')[0]} className="mt-4 text-sm" />
          </section>

          <H2 id="authentication">Authentication</H2>
          <p className="mt-2 text-sm">
            Each operation says which credential it takes. A token is bound to one auction and one kind. None of these is a real value
            on this page.
          </p>
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Credentials table">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-fd-foreground">
                  <th scope="col" className="py-1 pr-4 font-semibold">Scheme</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Sent as</th>
                  <th scope="col" className="py-1 font-semibold">What it is</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries<J>(spec.schemes).map(([name, sc]) => (
                  <tr key={name} className="border-b border-fd-border align-top">
                    <td className="py-1 pr-4 font-mono">{name}</td>
                    <td className="py-1 pr-4 font-mono text-fd-muted-foreground">
                      {sc.type === 'apiKey' ? `${sc.name} header` : 'Authorization: Bearer'}
                    </td>
                    <td className="py-1">
                      <Prose text={sc.description} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H2 id="errors">Errors</H2>
          <p className="mt-2 text-sm">
            Every error is JSON with a <code className="font-mono">message</code>. Read the stable code as{' '}
            <code className="font-mono">code ?? error</code>: some routes send <code className="font-mono">code</code>, others{' '}
            <code className="font-mono">error</code>. <code className="font-mono">detail</code> is optional extra text.
          </p>
          <pre className="mt-3 overflow-x-auto border border-fd-border bg-fd-muted p-3 font-mono text-xs" tabIndex={0}>
            <code>{`{ "code": "bad_message", "message": "invalid request body", "detail": "config.reserve: reserve must be at least 100 cents" }`}</code>
          </pre>
          <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="HTTP statuses table">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-fd-foreground">
                  <th scope="col" className="py-1 pr-4 font-semibold">Status</th>
                  <th scope="col" className="py-1 font-semibold">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map(([c, d]) => (
                  <tr key={c} className="border-b border-fd-border align-top">
                    <td className="py-1 pr-4 font-mono font-bold">{c}</td>
                    <td className="py-1">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Array.isArray(errorCodes?.enum) ? (
            <>
              <h3 id="error-codes" className="mt-6 scroll-mt-20 font-bold">Error codes</h3>
              <p className="mt-1 text-sm">{errorCodes.description}</p>
              <p className="mt-2 font-mono text-xs leading-relaxed break-words">{errorCodes.enum.join('  ')}</p>
            </>
          ) : null}
          {Array.isArray(extraCodes?.enum) ? (
            <>
              <h3 className="mt-6 font-bold">More codes (judge rooms, holds, lookups)</h3>
              <p className="mt-2 font-mono text-xs leading-relaxed break-words">{extraCodes.enum.join('  ')}</p>
            </>
          ) : null}

          <H2 id="rate-limits">Rate limits</H2>
          <p className="mt-2 text-sm">Per source address, token bucket. A 429 always carries Retry-After.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {Object.entries<J>(limits).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono">{k}</span>: {v.perMinute} a minute, burst {v.burst}. {v.description}
              </li>
            ))}
          </ul>

          <H2 id="endpoints">Endpoints</H2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fd-muted-foreground">
            <MethodBadge method="get" /> <MethodBadge method="post" /> <MethodBadge method="delete" /> Use the left list or the filter to jump to one.
          </p>
          {spec.groups.map((g) => (
            <section key={g.tag} aria-labelledby={`h-${slugOf(g.tag)}`} className="mt-10">
              <h3 id={`tag-${slugOf(g.tag)}`} className="scroll-mt-20 text-2xl font-bold">
                <span id={`h-${slugOf(g.tag)}`}>{g.tag}</span>
              </h3>
              {g.description ? <p className="mt-1 text-fd-muted-foreground">{g.description}</p> : null}
              <div className="mt-4">
                {g.ops.map((o) => (
                  <OperationView key={o.id} spec={spec} o={o} />
                ))}
              </div>
            </section>
          ))}

          <H2 id="sdks">SDKs with APIMatic</H2>
          <p className="mt-2 text-sm">
            GAVEL is entered for the sponsor prize "Best Use of APIMatic". The SDKs are generated by APIMatic from this OpenAPI
            document and published as a GitHub release. They are beta, sandbox only, and not on npm, PyPI or NuGet.
          </p>
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="SDK table">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-fd-foreground">
                  <th scope="col" className="py-1 pr-4 font-semibold">Language</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Install from the release asset</th>
                  <th scope="col" className="py-1 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['TypeScript', 'npm install ./gavel-sdk-0.0.5.tgz', 'typescript'],
                  ['Python', 'pip install ./gavel_sdk-0.0.5-py3-none-any.whl', 'python'],
                  ['C#', 'dotnet add package GavelSdk --version 0.0.5 --source .', 'csharp'],
                ].map(([l, cmd, dir]) => (
                  <tr key={l} className="border-b border-fd-border align-top">
                    <td className="py-1 pr-4 font-semibold">{l}</td>
                    <td className="py-1 pr-4 font-mono text-xs break-all">{cmd}</td>
                    <td className="py-1">
                      <a className="underline" href={`${repoUrl}/tree/main/sdks/${dir}`}>sdks/{dir}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm">
            Download the asset from the <a className="underline" href={sdkRelease}>sdk-v0.0.5 release</a> (beta), then run the command in
            the folder that holds it. The default server in the SDKs is the sandbox host. The WebSocket is outside what an OpenAPI
            generator produces, so live bidding stays on the{' '}
            <a className="underline" href="/docs/reference/websocket-protocol">documented socket protocol</a>.
          </p>
          <p className="mt-3 border-l-4 border-fd-foreground bg-fd-muted p-3 text-sm">
            The APIMatic developer portal (reference docs, code samples, try-it) is generated but not hosted at a public address yet.
            This page is the hosted reference.
          </p>
        </div>
      </div>
    </div>
  );
}
