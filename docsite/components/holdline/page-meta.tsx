import { cn } from '@/lib/cn';
import { gateById } from '@/lib/repo-data';

// The strip under every page title: what state the page is in, what that rests on, and when the
// page last changed. Status words are the site's four plus two more, each with its own fill, so
// the state never rests on colour alone.
const kinds: Record<string, { label: string; cls: string; meaning: string }> = {
  verified: { label: 'Verified', cls: 'hl-solid-chip', meaning: 'backed by a real run or committed evidence' },
  pass: { label: 'Pass', cls: 'hl-solid-chip', meaning: 'a real sandbox run passed' },
  'code-checked': { label: 'Code-checked', cls: 'hl-checked-chip', meaning: 'read against the code it describes; nothing was run' },
  simulated: { label: 'Simulated', cls: 'hl-hatch-chip', meaning: 'our code over a model of PayPal on a fake clock' },
  running: { label: 'Running', cls: 'hl-hatch-chip', meaning: 'a real run is under way; the final reading date is on the page' },
  ongoing: { label: 'Ongoing', cls: 'hl-hatch-chip', meaning: 'work on this page is still under way; the next step is named on the page' },
  described: { label: 'Described', cls: 'hl-hatch-chip', meaning: 'described in full; not yet exercised in a recorded run' },
  measured: { label: 'Measured', cls: 'hl-hatch-chip', meaning: 'measured; the limits and the next step are stated on the page' },
  tested: { label: 'Tested, synthetic clips', cls: 'hl-hatch-chip', meaning: 'tested with synthetic data, with a safeguard on every use; the page says what a live test would add' },
  fail: { label: 'Fail', cls: 'hl-stop-chip', meaning: 'measured and below the limit' },
  planned: { label: 'Planned', cls: 'hl-hollow-chip', meaning: 'not done yet' },
};

export function PageMeta({
  slugs,
  status,
  evidence,
  changed,
}: {
  slugs: string[];
  status?: string;
  evidence?: string;
  changed?: Date | null;
}) {
  const gate = /^gate-g(\d)$/.exec(slugs[1] ?? '');
  let key = status?.toLowerCase();
  let gateNote: string | undefined;
  if (slugs[0] === 'proof' && gate) {
    // Gate pages take their word from docs/GATES.md, so the strip cannot drift from the record.
    const g = gateById(`G${gate[1]}`);
    key = g.status === 'PASS' ? 'pass' : g.status === 'FAIL' ? 'fail' : g.status === 'PARTIAL' ? (g.id === 'G5' ? 'tested' : 'measured') : 'running';
    gateNote = `Gate ${g.id}: ${g.status === 'NOT RUN' ? 'running, final reading 12 Nov' : g.status === 'PARTIAL' ? (g.id === 'G5' ? 'tested with synthetic voice clips, confirm step on every bid' : 'measured') : g.status}. Read from docs/GATES.md when the site is built.`;
  }
  const k = key ? kinds[key] : undefined;
  if (!k && !changed) return null;
  const date = changed
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(changed)
    : null;
  return (
    <div className="hl-meta not-prose mt-4 flex flex-wrap items-start gap-x-5 gap-y-2 border-y border-[var(--hl-hairline)] py-3">
      {k && (
        <p className="flex items-center gap-2">
          <span
            data-status={key}
            className={cn(
              'rounded-[2px] px-2 py-0.5 font-mono text-[0.72rem] font-bold uppercase tracking-wide',
              k.cls,
            )}
          >
            {k.label}
          </span>
          <span className="text-[0.8rem] text-fd-muted-foreground">{k.meaning}</span>
        </p>
      )}
      {(gateNote ?? evidence) && (
        <p className="basis-full text-[0.82rem] leading-snug">
          <span className="hl-eyebrow me-2">Verified against</span>
          {gateNote ?? evidence}
        </p>
      )}
      {date && (
        <p className="basis-full font-mono text-[0.7rem] text-fd-muted-foreground">
          Page last changed {date} (from the git history)
        </p>
      )}
    </div>
  );
}
