#!/usr/bin/env node
// Fails when a text file contains a word from the banned list (R-QA-017).
// The list is read from env BANNED_WORDS (comma or newline separated, a CI secret) or from the
// untracked file scripts/banned-words.txt. The list is never committed and never printed:
// failures report only file, line and column.
// Besides file contents it checks file paths, and on request free text from the environment
// (--text NAME: a pull request title, body or branch name) and commit messages
// (--git-log RANGE: the git log arguments, such as "base..head"). Hits in paths, text and commit
// messages are reported by position or short commit id only, never by the text itself.
// In commit messages only, co-author trailer lines ("<key>: Name <email>") are ignored so a
// co-author's name cannot fail the check; the subject, body and other trailers are still checked.
// Usage: node scripts/check-banned-words.mjs            whole tree (tracked files)
//        node scripts/check-banned-words.mjs a.md b.ts  only the given files (pre-commit)
//        node scripts/check-banned-words.mjs --text PR_TITLE --git-log "origin/main..HEAD"
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readText, selectFiles } from './lib-text-check.mjs';

const scriptRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function parseWordList(raw) {
  return raw
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter((w) => w !== '' && !w.startsWith('#'));
}

export function loadWordList(rootDir, env) {
  if (env.BANNED_WORDS && env.BANNED_WORDS.trim() !== '') return parseWordList(env.BANNED_WORDS);
  const local = join(rootDir, 'scripts', 'banned-words.txt');
  if (existsSync(local)) return parseWordList(readFileSync(local, 'utf8'));
  return [];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(words) {
  if (words.length === 0) return undefined;
  return new RegExp(`(?<![A-Za-z0-9])(?:${words.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`, 'i');
}

/** Returns [{line, column}] for each line that contains a listed word. */
export function findBanned(text, matcher) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = matcher.exec(lines[i]);
    if (m) found.push({ line: i + 1, column: m.index + 1 });
  }
  return found;
}

export function checkFiles(rootDir, files, matcher) {
  const failures = [];
  for (const file of files) {
    const normal = file.replace(/\\/g, '/').replace(/^\.\//, '');
    const text = readText(rootDir, normal);
    if (text === undefined) continue;
    for (const hit of findBanned(text, matcher)) failures.push({ file: normal, ...hit });
  }
  return failures;
}

/** Returns the files whose path (any directory or file name part) contains a listed word. */
export function checkPaths(files, matcher) {
  const failures = [];
  for (const file of files) {
    const normal = file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (matcher.test(normal)) failures.push({ index: failures.length + 1 });
  }
  return failures;
}

/** Checks free text such as a pull request title; reports line and column only. */
export function checkText(label, text, matcher) {
  return findBanned(text ?? '', matcher).map((h) => ({ label, ...h }));
}

/** Splits `git log --format=%B%x00` output into commit messages. */
export function splitLog(out) {
  return out.split('\0').filter((m) => m.trim() !== '');
}

const COAUTHOR_KEY = ['Co', 'authored', 'by'].join('-');
const COAUTHOR_LINE = new RegExp(`^\\s*${COAUTHOR_KEY}:\\s.*$`, 'i');

/** Drops co-author trailer lines from a commit message. */
export function stripCoAuthorTrailers(message) {
  return message
    .split('\n')
    .filter((line) => !COAUTHOR_LINE.test(line))
    .join('\n');
}

/** Checks the message of every commit in the git range; reports the short commit id only. */
export function checkCommits(rootDir, range, matcher, run = execFileSync) {
  const out = run('git', ['log', '--format=%h%x01%B%x00', ...range.split(/\s+/).filter(Boolean)], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const failures = [];
  for (const entry of splitLog(out)) {
    const [id, ...body] = entry.trim().split('\u0001');
    if (matcher.test(stripCoAuthorTrailers(body.join('\u0001')))) failures.push({ commit: id });
  }
  return failures;
}

/**
 * Decides what to do when no word list is configured. Outside CI a missing list is skipped so
 * local runs work; in CI it is a failure, except where the run opts out (pull requests from
 * forks never receive the secret, and the same check runs again on the main branch).
 */
export function emptyListOutcome(env) {
  if (env.CI !== 'true' && env.CI !== '1') return 'skip';
  return env.BANNED_WORDS_ALLOW_EMPTY === 'true' ? 'skip' : 'fail';
}

/** Splits argv into the optional --root <dir> (the tree to scan) and the file arguments. */
export function parseArgs(argv) {
  const files = [];
  let target;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') target = argv[(i += 1)];
    else if (argv[i] === '--text' || argv[i] === '--git-log') i += 1;
    else files.push(argv[i]);
  }
  return { target, files };
}

/** Reads the --text NAME and --git-log RANGE options. */
export function parseMetaArgs(argv) {
  const texts = [];
  const logs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--text') texts.push(argv[(i += 1)]);
    else if (argv[i] === '--git-log') logs.push(argv[(i += 1)]);
  }
  return { texts, logs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The script may run from a trusted checkout (the base commit) while scanning another tree.
  const { target, files: given } = parseArgs(process.argv.slice(2));
  const root = target ? join(process.cwd(), target) : scriptRoot;
  const matcher = buildMatcher(loadWordList(root, process.env));
  if (!matcher) {
    if (emptyListOutcome(process.env) === 'fail') {
      console.error('check:banned-words failed: no word list configured in CI (BANNED_WORDS)');
      process.exit(1);
    }
    console.log('check:banned-words skipped: no word list configured (BANNED_WORDS or local file)');
    process.exit(0);
  }
  const files = selectFiles(root, given);
  const failures = checkFiles(root, files, matcher);
  for (const f of failures) console.error(`${f.file}:${f.line}:${f.column} contains a banned word`);
  const pathHits = checkPaths(files, matcher);
  for (const h of pathHits) console.error(`file path #${h.index} contains a banned word`);
  const meta = parseMetaArgs(process.argv.slice(2));
  const textHits = meta.texts.flatMap((name) => checkText(name, process.env[name], matcher));
  for (const h of textHits)
    console.error(`${h.label}:${h.line}:${h.column} contains a banned word`);
  const commitHits = meta.logs.flatMap((range) => checkCommits(root, range, matcher));
  for (const h of commitHits) console.error(`commit ${h.commit} message contains a banned word`);
  const total = failures.length + pathHits.length + textHits.length + commitHits.length;
  if (total > 0) {
    console.error(`check:banned-words failed: ${total} match(es)`);
    process.exit(1);
  }
  console.log(`check:banned-words ok (${files.length} files)`);
}
