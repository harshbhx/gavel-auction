import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyG5ToGates, deepgramTranscribe, runG5, type G5Fetch } from './g5.js';
import { writeSpecResult } from '../sandbox/harness.js';

// Manual and nightly entry point of the G5 harness. From packages/e2e:
//   vite-node src/gates/g5-cli.ts [--write-gates]
// Needs DEEPGRAM_API_KEY and G5_AUDIO_DIR (one <id>.wav per utterance). Skips when either is
// missing. --write-gates updates the G5 block of docs/GATES.md.

const env = process.env;
const dir = env['G5_AUDIO_DIR'] ?? '';
const run = await runG5({
  env,
  readAudio: (id) => {
    const path = join(dir, `${id}.wav`);
    return dir !== '' && existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
  },
  transcribe: (audio, key) => deepgramTranscribe(audio, key, fetch as unknown as G5Fetch),
  now: () => Date.now(),
});
const finishedAt = new Date().toISOString();
if (run.status === 'skipped') {
  console.log(`G5 skipped: ${run.reason}`);
  writeSpecResult('report/sandbox/results', {
    spec: 'G5',
    gate: 'none',
    status: 'skipped',
    observed: run.reason,
    facts: {},
    finishedAt,
  });
} else {
  const s = run.summary;
  console.log(
    `G5 ${s.verdict}: exact ${s.exactRate.toFixed(3)}, confirm ${s.confirmRate.toFixed(3)}`,
  );
  mkdirSync('report/sandbox/results', { recursive: true });
  writeSpecResult('report/sandbox/results', {
    spec: 'G5',
    gate: 'none',
    status: s.verdict === 'PASS' ? 'pass' : s.verdict === 'PARTIAL' ? 'inconclusive' : 'fail',
    observed: `verdict ${s.verdict}, exact ${s.exactRate.toFixed(3)}, confirm ${s.confirmRate.toFixed(3)}`,
    facts: { n: s.n, exact: s.exact, confirm: s.confirm, wrongAccept: s.wrongAccept },
    finishedAt,
  });
  if (process.argv.includes('--write-gates')) {
    const path = '../../docs/GATES.md';
    writeFileSync(path, applyG5ToGates(readFileSync(path, 'utf8'), run, finishedAt.slice(0, 10)));
  }
}
