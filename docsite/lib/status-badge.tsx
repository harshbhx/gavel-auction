import { cn } from './cn';

// Sidebar badge for the `status` frontmatter field (see statusBadgesPlugin in lib/source.ts).
// The badge says the state in words and carries the Holdline fill, so colour is never the
// only signal: solid = verified, hatched = in progress or unverified, hollow = not done.
const styles: Record<string, string> = {
  verified: 'hl-solid-chip',
  pass: 'hl-solid-chip',
  simulated: 'hl-hatch-chip',
  'in progress': 'hl-hatch-chip',
  unverified: 'hl-hatch-chip',
  fail: 'hl-stop-chip',
  planned: 'hl-hollow-chip',
  new: 'hl-solid-chip',
};

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  return (
    <span
      data-status={key}
      className={cn(
        'ms-auto shrink-0 rounded-[2px] px-1.5 py-px font-mono text-[0.625rem] font-medium uppercase leading-4 tracking-wide',
        styles[key] ?? 'hl-hollow-chip',
      )}
    >
      {status}
    </span>
  );
}
