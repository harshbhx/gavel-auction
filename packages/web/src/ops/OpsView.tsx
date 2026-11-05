/** Shape served by `GET /ops/summary` on the server host (R-QA-047). */
export interface OpsSummaryView {
  readonly logs: readonly string[];
  readonly sagas: ReadonlyArray<{
    readonly auctionId: string;
    readonly lotId: string;
    readonly state: string;
  }>;
  readonly paypal: Readonly<Record<string, number>>;
}

/** Visible text, supplied by the caller so the copy lives in one place. */
export interface OpsLabels {
  readonly title: string;
  readonly loading: string;
  readonly sagas: string;
  readonly noSagas: string;
  readonly paypal: string;
  readonly logs: string;
}

export interface OpsViewProps {
  readonly summary: OpsSummaryView | undefined;
  readonly labels: OpsLabels;
  readonly error?: string;
}

/** Operator page: the last log lines, saga state per lot and PayPal outcomes. */
export function OpsView({ summary, labels, error }: OpsViewProps) {
  if (error !== undefined) return <p role="alert">{error}</p>;
  if (summary === undefined) return <p>{labels.loading}</p>;
  return (
    <main aria-label={labels.title}>
      <h1>{labels.title}</h1>
      <section aria-label={labels.sagas}>
        <h2>{labels.sagas}</h2>
        {summary.sagas.length === 0 ? (
          <p>{labels.noSagas}</p>
        ) : (
          <ul>
            {summary.sagas.map((s) => (
              <li key={`${s.auctionId}:${s.lotId}`}>{`${s.auctionId} ${s.lotId} ${s.state}`}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={labels.paypal}>
        <h2>{labels.paypal}</h2>
        <ul>
          {Object.entries(summary.paypal).map(([k, v]) => (
            <li key={k}>{`${k}: ${String(v)}`}</li>
          ))}
        </ul>
      </section>
      <section aria-label={labels.logs}>
        <h2>{labels.logs}</h2>
        <pre>{summary.logs.join('\n')}</pre>
      </section>
    </main>
  );
}

/** Fetches the summary with the operator key; the key stays in memory and is never stored. */
export async function fetchOpsSummary(
  baseUrl: string,
  adminKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpsSummaryView> {
  const res = await fetchImpl(`${baseUrl}/ops/summary`, { headers: { 'x-admin-key': adminKey } });
  if (!res.ok) throw new Error(`ops summary failed with status ${String(res.status)}`);
  return (await res.json()) as OpsSummaryView;
}
