import { repoData } from '@/lib/repo-data';
import { Chip } from './chip';

// Tables whose rows are read from the committed repo evidence by scripts/gen-repo-data.mjs
// (docs/GATES.md and docs/evidence/SIM/SIM-MULTIDAY.md), so they cannot differ from the repo.
const table = 'not-prose my-6 w-full border-collapse text-left text-sm';
const th = 'border-b-2 border-[var(--hl-border)] px-2 py-2 font-mono text-[0.68rem] uppercase tracking-wide text-fd-muted-foreground';
const td = 'border-b border-[var(--hl-hairline)] px-2 py-2 align-top';

function Scroll({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="fd-scroll-container overflow-x-auto"
    >
      {children}
    </div>
  );
}

export function GatesTable() {
  return (
    <Scroll label="Gate results">
      <table className={table}>
        <thead>
          <tr>
            <th className={th}>Gate</th>
            <th className={th}>Question</th>
            <th className={th}>Result</th>
            <th className={th}>Run</th>
          </tr>
        </thead>
        <tbody>
          {repoData.gates.map((g) => {
            const inProgress = g.id === 'G3' && g.status === 'NOT RUN';
            return (
              <tr key={g.id}>
                <td className={`${td} font-mono font-bold`}>{g.id}</td>
                <td className={td}>{g.title}</td>
                <td className={td}>
                  <Chip
                    kind={
                      g.status === 'PASS'
                        ? 'solid'
                        : g.status === 'FAIL'
                          ? 'stop'
                          : inProgress
                            ? 'hatched'
                            : 'hollow'
                    }
                  >
                    {inProgress ? 'IN PROGRESS' : g.status}
                  </Chip>
                </td>
                <td className={`${td} max-w-[28rem] text-fd-muted-foreground`}>
                  {inProgress ? 'Real probe. Day 0 was 7 Nov 2026 03:06 UTC. Final reading about 12 Nov 06:17 UTC.' : g.run}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Scroll>
  );
}

export function SpeechTable() {
  return (
    <Scroll label="Speech to text accuracy, gate G5">
      <table className={table}>
        <caption className="sr-only">
          Speech to text accuracy on 24 synthetic clips per set. The limit for wrong accepts is 0.05.
        </caption>
        <thead>
          <tr>
            <th className={th}>Clip set</th>
            <th className={th}>Provider</th>
            <th className={th}>n</th>
            <th className={th}>Exact</th>
            <th className={th}>Wrong accept (limit 0.05)</th>
            <th className={th}>Confirm</th>
            <th className={th}>Missed bid</th>
          </tr>
        </thead>
        <tbody>
          {repoData.speech.map((r) => (
            <tr key={`${r.clipSet}-${r.provider}`}>
              <td className={td}>{r.clipSet}</td>
              <td className={td}>{r.provider}</td>
              <td className={`${td} font-mono`}>{r.n}</td>
              <td className={`${td} font-mono`}>{r.exact}</td>
              <td className={`${td} font-mono font-bold`}>
                {r.wrongAccept} <span className="text-[var(--hl-stop)]">over limit</span>
              </td>
              <td className={`${td} font-mono`}>{r.confirm}</td>
              <td className={`${td} font-mono`}>{r.missedBid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}

export function LatencyTable() {
  return (
    <Scroll label="Sandbox latency">
      <table className={table}>
        <caption className="sr-only">PayPal sandbox call latency in milliseconds, 10 samples per call.</caption>
        <thead>
          <tr>
            <th className={th}>Call</th>
            <th className={th}>p50 (ms)</th>
            <th className={th}>p95 (ms)</th>
            <th className={th}>max (ms)</th>
          </tr>
        </thead>
        <tbody>
          {repoData.latency.map((r) => (
            <tr key={r.call}>
              <td className={`${td} font-mono`}>{r.call}</td>
              <td className={`${td} font-mono`}>{r.p50}</td>
              <td className={`${td} font-mono`}>{r.p95}</td>
              <td className={`${td} font-mono`}>{r.max}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}

export function SimScenarioTable() {
  return (
    <Scroll label="Simulated multi-day scenarios">
      <table className={table}>
        <caption className="sr-only">Simulated scenarios on a fake PayPal and a fake clock.</caption>
        <thead>
          <tr>
            <th className={th}>Scenario</th>
            <th className={th}>Title</th>
            <th className={th}>Checks</th>
            <th className={th}>Result</th>
          </tr>
        </thead>
        <tbody>
          {repoData.sim.scenarios.map((s) => (
            <tr key={s.id}>
              <td className={`${td} font-mono font-bold`}>{s.id}</td>
              <td className={td}>{s.title}</td>
              <td className={`${td} font-mono`}>{s.checks}</td>
              <td className={td}>
                <Chip kind="hatched">{`SIMULATED ${s.result}`}</Chip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}
