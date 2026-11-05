// R6-E04: the gitleaks allowlist no longer skips node_modules, so no tracked path may contain a
// node_modules segment (a force-added file there would otherwise be committed unscanned or noisy).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function findNodeModulesPaths(paths) {
  return paths.filter((p) => p.split('/').includes('node_modules'));
}

function main() {
  const res = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.status !== 0) {
    console.error('git ls-files failed');
    process.exit(2);
  }
  const bad = findNodeModulesPaths(res.stdout.split('\0').filter(Boolean));
  if (bad.length > 0) {
    console.error(`tracked paths with a node_modules segment:\n${bad.join('\n')}`);
    process.exit(1);
  }
  console.log('no tracked node_modules paths');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
