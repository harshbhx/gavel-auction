// QA-76: checks a fresh clone is fit to be shared. File-list and file-presence checks only; secret
// content scanning stays in gitleaks (.gitleaks.toml), this script does not duplicate it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_ALLOWED = new Set(['.env.example', '.env.sample', '.env.template']);
const KEY_FILE = /(^|\/)(id_rsa|id_ed25519)$|\.(pem|p12|pfx|key|keystore|jks)$/i;
export const REQUIRED = ['LICENSE', 'docs/PUBLIC-REPO-CHECKLIST.md', 'docs/JUDGES.md'];

export function isEnvFile(path) {
  const base = path.split('/').pop();
  return (base === '.env' || base.startsWith('.env.')) && !ENV_ALLOWED.has(base);
}

/** Returns a list of problem strings (empty when the clone is clean). */
export function checkCleanClone({ files, readme }) {
  const problems = [];
  const set = new Set(files);
  for (const f of REQUIRED) if (!set.has(f)) problems.push(`missing required file: ${f}`);
  if (!/^#{1,3}\s+Run\b/im.test(readme) || !/\bnpm ci\b/.test(readme)) {
    problems.push('README.md has no run instructions (a "Run" heading with npm ci)');
  }
  for (const f of files) {
    if (isEnvFile(f)) problems.push(`tracked env file: ${f}`);
    else if (KEY_FILE.test(f)) problems.push(`tracked key or certificate file: ${f}`);
  }
  return problems;
}

function main(root = process.cwd()) {
  const res = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (res.status !== 0) {
    console.error('git ls-files failed');
    process.exit(2);
  }
  const files = res.stdout.split('\0').filter(Boolean);
  const readmePath = join(root, 'README.md');
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  const problems = checkCleanClone({ files, readme });
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('clean clone check passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
