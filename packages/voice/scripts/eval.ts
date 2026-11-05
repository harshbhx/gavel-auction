/** Node entry for src/eval/cli.ts. Run: npm run eval -- --mode text */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/eval/cli.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
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
  log: (line) => console.log(line),
});
process.exit(code);
