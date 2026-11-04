#!/usr/bin/env node
// Fails when a change touches files outside the area named by its issue key.
// Inputs (flags or env):
//   --key / PR_KEY        issue key such as ENG-03 (or parsed from --title / PR_TITLE)
//   --title / PR_TITLE    PR title that starts with the key
//   --labels / PR_LABELS  comma separated labels
//   --files               comma separated changed files (otherwise git diff against --base)
//   --base / BASE_REF     base ref for git diff, default origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

const matches = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

export function parseKey(text) {
  const m = /^\s*\[?([A-Z]{2,4})-(\d{1,3})\b/.exec(text ?? '');
  return m ? `${m[1]}-${m[2]}` : null;
}

export function checkOwnership({ key, files, labels, map }) {
  if (labels.includes(map.bypassLabel)) return { ok: true, violations: [], reason: 'bypass label' };
  const prefix = key ? key.split('-')[0] : null;
  const allowed = prefix ? map.areas[prefix] : undefined;
  if (!allowed) {
    return { ok: false, violations: [], reason: `unknown or missing issue key: ${key ?? 'none'}` };
  }
  const violations = files.filter((f) => !matches(f, map.exempt) && !matches(f, allowed));
  return { ok: violations.length === 0, violations, reason: '' };
}

function arg(name, env) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) return process.argv[i + 1];
  return process.env[env];
}

function main() {
  const map = JSON.parse(readFileSync(join(here, 'ownership.map.json'), 'utf8'));
  const key = arg('key', 'PR_KEY') ?? parseKey(arg('title', 'PR_TITLE'));
  const labels = (arg('labels', 'PR_LABELS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let files = arg('files', 'PR_FILES');
  if (files === undefined) {
    const base = arg('base', 'BASE_REF') ?? 'origin/main';
    files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
      .split('\n')
      .join(',');
  }
  const list = files
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const result = checkOwnership({ key, files: list, labels, map });
  if (result.ok) {
    console.log(
      `ownership ok (${key ?? 'n/a'}, ${list.length} files)${result.reason ? `: ${result.reason}` : ''}`,
    );
    return 0;
  }
  console.error(`ownership check failed for ${key ?? 'no key'}`);
  if (result.reason) console.error(`  ${result.reason}`);
  for (const v of result.violations) console.error(`  outside area: ${v}`);
  console.error('Add the cross-area label if this is intended.');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
