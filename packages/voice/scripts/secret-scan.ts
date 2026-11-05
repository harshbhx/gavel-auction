/**
 * Fails when a vendor key pattern appears in the voice package sources (R-VOX-023).
 * Findings print file and line only, never the matched text.
 * Run: node --experimental-strip-types scripts/secret-scan.ts [dir ...]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'groq-key', re: /\bgsk_[A-Za-z0-9]{20,}/ },
  { name: 'deepgram-prefixed-key', re: /\bdg_[A-Za-z0-9]{16,}/ },
  { name: 'long-hex', re: /\b[0-9a-fA-F]{40}\b/ },
];

export interface Finding {
  file: string;
  line: number;
  pattern: string;
}

export function scanText(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(line)) out.push({ file, line: i + 1, pattern: p.name });
    }
  }
  return out;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'fixtures', '.git']);
const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|env|html)$/;

function walk(dir: string, acc: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (SCAN_EXT.test(name)) acc.push(full);
  }
  return acc;
}

export function scanDirs(dirs: readonly string[]): Finding[] {
  const found: Finding[] = [];
  for (const d of dirs) {
    for (const f of walk(d, [])) found.push(...scanText(f, readFileSync(f, 'utf8')));
  }
  return found;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dirs =
    process.argv.length > 2
      ? process.argv.slice(2)
      : ['src', 'test', 'scripts', 'docs'].map((d) => join(root, d));
  const findings = scanDirs(dirs);
  for (const f of findings) console.error(`secret-scan: ${f.file}:${f.line} ${f.pattern}`);
  if (findings.length > 0) process.exit(1);
  console.log('secret-scan: clean');
}
