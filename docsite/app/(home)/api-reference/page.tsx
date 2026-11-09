import type { Metadata } from 'next';
import { loadSpec, type J } from '@/lib/openapi';
import { OperationView } from '@/components/api/operation';
import { Prose } from '@/components/api/text';
import { repoUrl } from '@/lib/shared';

export const metadata: Metadata = {
  title: 'API reference',
  description:
    'Every HTTP endpoint of the GAVEL host, grouped by tag, with parameters, request and response schemas, examples, authentication and error codes. Rendered from openapi/gavel.yaml at build time.',
};

export default function ApiReferencePage() {
  const spec = loadSpec();
  const errorCodes: J = spec.root.components?.schemas?.ErrorCode;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">API reference</h1>
      <p className="mt-2 text-fd-muted-foreground">
        {spec.info.title}, version {spec.info.version}. PayPal sandbox only: no real money moves. This page is
        generated from <a className="underline" href={`${repoUrl}/blob/main/openapi/gavel.yaml`}>openapi/gavel.yaml</a> when
        the site is built, so it always matches the spec. <a className="underline" href="/openapi.yaml">Download openapi.yaml</a>.
      </p>

      <h2 className="mt-10 border-t-2 border-fd-foreground pt-4 text-xl font-bold">Servers</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {spec.servers.map((s: J) => (
          <li key={s.url}>
            <span className="font-mono">{s.url}</span> <span className="text-fd-muted-foreground">{s.description}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 border-t-2 border-fd-foreground pt-4 text-xl font-bold">Overview</h2>
      <Prose text={spec.info.description} className="mt-3 text-sm" />

      <h2 className="mt-10 border-t-2 border-fd-foreground pt-4 text-xl font-bold">Credentials</h2>
      <dl className="mt-3 space-y-3 text-sm">
        {Object.entries<J>(spec.schemes).map(([name, s]) => (
          <div key={name}>
            <dt className="font-mono font-semibold">
              {name}{' '}
              <span className="font-sans font-normal text-fd-muted-foreground">
                {s.type === 'apiKey' ? `header ${s.name}` : 'Authorization: Bearer'}
              </span>
            </dt>
            <dd className="mt-0.5">
              <Prose text={s.description} />
            </dd>
          </div>
        ))}
      </dl>

      {Array.isArray(errorCodes?.enum) ? (
        <>
          <h2 id="error-codes" className="mt-10 scroll-mt-20 border-t-2 border-fd-foreground pt-4 text-xl font-bold">
            Error codes
          </h2>
          <p className="mt-2 text-sm">{errorCodes.description}</p>
          <p className="mt-2 font-mono text-sm leading-relaxed">{errorCodes.enum.join('  ')}</p>
        </>
      ) : null}

      <h2 className="mt-10 border-t-2 border-fd-foreground pt-4 text-xl font-bold">Endpoints</h2>
      <nav aria-label="Endpoint groups" className="mt-3">
        <ul className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          {spec.groups.map((g) => (
            <li key={g.tag}>
              <a className="underline underline-offset-2" href={`#tag-${g.tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                {g.tag}
              </a>{' '}
              <span className="text-fd-muted-foreground">({g.ops.length})</span>
            </li>
          ))}
        </ul>
      </nav>

      {spec.groups.map((g) => (
        <section key={g.tag} aria-labelledby={`h-${g.tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="mt-12">
          <h2
            id={`tag-${g.tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            className="scroll-mt-20 border-t-2 border-fd-foreground pt-4 text-2xl font-bold"
          >
            <span id={`h-${g.tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{g.tag}</span>
          </h2>
          {g.description ? <p className="mt-1 text-fd-muted-foreground">{g.description}</p> : null}
          <div className="mt-4">
            {g.ops.map((o) => (
              <OperationView key={o.id} spec={spec} o={o} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
