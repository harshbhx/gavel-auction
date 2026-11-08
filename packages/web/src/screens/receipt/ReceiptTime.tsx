import { formatTime, formatTimeUtc } from '../../ui/format';

/** The settle time of a receipt: readable in the viewer's locale, exact UTC in the title and name. */
export function ReceiptTime({ at }: { readonly at: number }) {
  const local = formatTime(at);
  const utc = formatTimeUtc(at);
  return (
    <time dateTime={new Date(at).toISOString()} title={utc} aria-label={`${local} (${utc})`}>
      {local}
    </time>
  );
}
