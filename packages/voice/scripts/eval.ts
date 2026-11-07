/** Node entry for src/eval/cli.ts. Run: npm run eval -- --mode text */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLiveTranscriber, type LiveFetch, type LiveOptions } from '../src/eval/live.js';
import { runCli } from '../src/eval/cli.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const audioDir = process.env['G5_AUDIO_DIR'] ?? join(root, 'fixtures/audio/recordings');
const wavPath = (id: string): string => join(audioDir, `${id}.wav`);
const readAudio = (id: string): Uint8Array | undefined =>
  existsSync(wavPath(id)) ? new Uint8Array(readFileSync(wavPath(id))) : undefined;

/** Option trials (see docs/GATES.md, G5 provider options): environment variables, none of them a secret. */
function liveOptions(): LiveOptions {
  const env = process.env;
  const out: LiveOptions = {};
  const query = env['G5_DEEPGRAM_QUERY'];
  const model = env['G5_GROQ_MODEL'];
  const prompt = env['G5_GROQ_PROMPT'];
  const temperature = env['G5_GROQ_TEMPERATURE'];
  if (query !== undefined && query !== '') out.deepgramQuery = query;
  if (model !== undefined && model !== '') out.groqModel = model;
  if (prompt !== undefined && prompt !== '') out.groqPrompt = prompt;
  if (temperature !== undefined && temperature !== '') out.groqTemperature = temperature;
  return out;
}

const code = await runCli(process.argv.slice(2), {
  readFile: (p) => readFileSync(join(root, p), 'utf8'),
  exists: (p) => existsSync(join(root, p)),
  writeFile: (p, data) => {
    const full = join(root, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  },
  env: process.env,
  gitSha,
  recordingExists: (id) => existsSync(wavPath(id)),
  transcribe: createLiveTranscriber(readAudio, {
    fetch: fetch as unknown as LiveFetch,
    options: liveOptions(),
  }),
  log: (line) => console.log(line),
});
process.exit(code);
