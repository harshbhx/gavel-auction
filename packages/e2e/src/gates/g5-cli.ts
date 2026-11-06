import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyG5ToGates,
  evidenceName,
  renderEvidenceFile,
  runG5,
  sha256Hex,
  type G5Provider,
  type G5Run,
} from './g5.js';
import { transcribeLive, type LiveFetch } from '@gavel/voice';
import { writeSpecResult } from '../sandbox/harness.js';

// Manual and nightly entry point of the G5 harness. From packages/e2e:
//   vite-node src/gates/g5-cli.ts [--write-gates]
// Needs G5_AUDIO_DIR (one <id>.wav per utterance) and DEEPGRAM_API_KEY and/or GROQ_API_KEY. Each
// provider is measured when its key is set and skipped otherwise. A Groq run, when present, is the
// one recorded in the gate. --write-gates updates the G5 block of docs/GATES.md and writes the
// redacted evidence file to docs/evidence/ with its sha256 on the Evidence line.

const env = process.env;
const dir = env['G5_AUDIO_DIR'] ?? '';
const base = {
  env,
  readAudio: (id: string) => {
    const path = join(dir, `${id}.wav`);
    return dir !== '' && existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
  },
  now: () => Date.now(),
};
// The same live adapters as `npm run eval -w @gavel/voice -- --mode live`: bounded retry on 429/5xx.
const live = { fetch: fetch as unknown as LiveFetch };
const runs = new Map<G5Provider, G5Run>();
runs.set(
  'deepgram',
  await runG5(
    {
      ...base,
      transcribe: async (audio, key) => (await transcribeLive('deepgram', audio, key, live)).text,
    },
    'deepgram',
  ),
);
runs.set(
  'groq',
  await runG5(
    {
      ...base,
      transcribe: async (audio, key) => (await transcribeLive('groq', audio, key, live)).text,
    },
    'groq',
  ),
);
const finishedAt = new Date().toISOString();
const date = finishedAt.slice(0, 10);
const done = [...runs.values()].flatMap((r) => (r.status === 'done' ? [r] : []));
const primary = done.find((r) => r.provider === 'groq') ?? done[0];
if (primary === undefined) {
  const reason = [...runs.entries()]
    .map(([p, r]) => `${p}: ${r.status === 'skipped' ? r.reason : 'done'}`)
    .join('; ');
  console.log(`G5 skipped: ${reason}`);
  writeSpecResult('report/sandbox/results', {
    spec: 'G5',
    gate: 'none',
    status: 'skipped',
    observed: reason,
    facts: {},
    finishedAt,
  });
} else {
  mkdirSync('report/sandbox/results', { recursive: true });
  const write = process.argv.includes('--write-gates');
  const evidenceDir = write ? '../../docs/evidence' : 'report/sandbox/evidence';
  mkdirSync(evidenceDir, { recursive: true });
  let primaryEvidence: { path: string; sha256: string } | undefined;
  for (const run of done) {
    const s = run.summary;
    const text = renderEvidenceFile(run, date);
    const name = evidenceName(run, date);
    writeFileSync(join(evidenceDir, name), text);
    if (run === primary) {
      primaryEvidence = { path: `docs/evidence/${name}`, sha256: sha256Hex(text) };
    }
    console.log(
      `G5 ${run.provider ?? 'deepgram'} ${s.verdict}: exact ${s.exactRate.toFixed(3)}, confirm ${s.confirmRate.toFixed(3)}`,
    );
  }
  const s = primary.summary;
  writeSpecResult('report/sandbox/results', {
    spec: 'G5',
    gate: 'none',
    status: s.verdict === 'PASS' ? 'pass' : s.verdict === 'PARTIAL' ? 'inconclusive' : 'fail',
    observed: `verdict ${s.verdict}, exact ${s.exactRate.toFixed(3)}, confirm ${s.confirmRate.toFixed(3)}`,
    facts: { n: s.n, exact: s.exact, confirm: s.confirm, wrongAccept: s.wrongAccept },
    finishedAt,
  });
  if (write) {
    const path = '../../docs/GATES.md';
    const md = readFileSync(path, 'utf8');
    writeFileSync(path, applyG5ToGates(md, primary, date, primaryEvidence));
  }
}
