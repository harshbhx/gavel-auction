#!/usr/bin/env node
// Writes MANIFEST.json and copies verify.py into every dataset folder.
// Usage: node scripts/hf/finalize.mjs OUT_DIR
// Run after build-datasets.mjs and to-parquet.py. MANIFEST.json holds, per dataset: the repository
// commit, the GitHub Actions run URL that built it (empty outside CI), the sha256 and size of every
// file, and the row count of every table (jsonl and parquet).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const rowsOfJsonl = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '').length;

export function main(outArg) {
  const out = resolve(outArg);
  const sha = commit();
  const runUrl =
    process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '';
  const parquetPath = join(out, 'parquet-rows.json');
  const parquet = existsSync(parquetPath) ? JSON.parse(readFileSync(parquetPath, 'utf8')) : {};
  const names = readdirSync(out).filter((n) => statSync(join(out, n)).isDirectory());
  for (const name of names) {
    const dir = join(out, name);
    copyFileSync(join(HERE, 'verify.py'), join(dir, 'verify.py'));
    const schema = JSON.parse(readFileSync(join(HERE, 'schemas', `${name}.json`), 'utf8'));
    writeFileSync(
      join(dir, 'CHANGELOG.md'),
      [
        `# Changelog of ${name}`,
        '',
        'Versions follow the table schema in scripts/hf/schemas: a new field or a changed meaning is a new minor or major version.',
        '',
        ...schema.changelog.map((c) => `## ${c.version}\n\n${c.note}\n`),
      ].join('\n'),
    );
    const files = walk(dir)
      .map((p) => relative(dir, p).split('\\').join('/'))
      .filter((p) => p !== 'MANIFEST.json')
      .sort();
    const entries = files.map((p) => {
      const buf = readFileSync(join(dir, p));
      const entry = {
        path: p,
        bytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'),
      };
      const table = schema.tables[p.replace(/\.(csv|parquet)$/, '.jsonl')];
      if (table !== undefined) entry.source = table.source;
      if (p.endsWith('.jsonl')) entry.rows = rowsOfJsonl(join(dir, p));
      if (p.endsWith('.parquet')) entry.rows = parquet[`${name}/${p}`] ?? null;
      return entry;
    });
    const manifest = {
      dataset: name,
      version: schema.version,
      commit: sha,
      repository: 'https://github.com/harshbhx/gavel-auction',
      build_run_url: runUrl,
      files: entries,
    };
    writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
    process.stdout.write(`manifest ${name}: ${entries.length} files\n`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    process.stderr.write('usage: finalize.mjs OUT_DIR\n');
    process.exitCode = 2;
  } else {
    main(process.argv[2]);
  }
}
