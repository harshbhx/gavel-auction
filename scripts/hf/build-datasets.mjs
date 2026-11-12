#!/usr/bin/env node
// Assembles the open datasets from the evidence committed in this repository.
//
// Usage:
//   node scripts/hf/build-datasets.mjs --out DIR [--dataset all|NAME] [--sim-dir DIR] [--trace-dir DIR]
//
// Inputs that are produced by earlier CI steps:
//   --sim-dir    output of the sim-multiday suite with SIM_EXPORT_DIR (lots.jsonl, holds.jsonl,
//                scenarios.jsonl, meta.json)
//   --trace-dir  NDJSON traces of the e2e scenarios (runner --trace DIR)
// A dataset whose input is missing is reported as an error (exit 1), never skipped silently.
//
// Output per dataset: README.md (the dataset card), data as .jsonl and .csv (parquet is added by
// scripts/hf/to-parquet.py), and for the audio set the .wav files. The script also writes
// summary.json (row counts per file) next to the dataset folders. No network, no secrets: the
// namespace only appears in the cards when HF_NAMESPACE is set, and it is a public name.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evidenceGroup,
  gateStatus,
  latencyRows,
  loadLatencyRuns,
  parseClaims,
  parseDate,
  walkEvidence,
} from './evidence-index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'packages', 'voice', 'fixtures');
const REPO_URL = 'https://github.com/harshbhx/gavel-auction';

export const DATASETS = [
  'gavel-stt-bids',
  'gavel-gates',
  'gavel-sim-30d',
  'gavel-latency',
  'gavel-audit-demo',
];

// ---------------------------------------------------------------------------------------------
// small helpers

export function parseArgs(argv) {
  const args = { out: '', dataset: 'all', simDir: '', traceDir: '', assurance: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${a} needs a value`);
      return argv[i];
    };
    if (a === '--out') args.out = next();
    else if (a === '--dataset') args.dataset = next();
    else if (a === '--sim-dir') args.simDir = next();
    else if (a === '--trace-dir') args.traceDir = next();
    else if (a === '--assurance') args.assurance = next();
    else throw new Error(`unknown flag ${a}`);
  }
  if (args.out === '') throw new Error('--out is required');
  if (args.dataset !== 'all' && !DATASETS.includes(args.dataset)) {
    throw new Error(`unknown dataset ${args.dataset}; use all or one of ${DATASETS.join(', ')}`);
  }
  return args;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function toJsonl(rows) {
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

/** Writes rows as <dir>/<name>.jsonl and <dir>/<name>.csv; returns the row count. */
function writeTable(dir, name, rows) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), toJsonl(rows));
  writeFileSync(join(dir, `${name}.csv`), toCsv(rows));
  return rows.length;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const round2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

export function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');
}

/** Word error rate by edit distance over normalized words (lower case, punctuation removed). */
export function wordErrorRate(reference, hypothesis) {
  const r = normalizeWords(reference);
  const h = normalizeWords(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= r.length; i += 1) {
    for (let j = 1; j <= h.length; j += 1) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[r.length][h.length] / r.length;
}

/** Duration of a PCM wav file in seconds, read from its header. */
export function wavSeconds(buf) {
  let pos = 12;
  let byteRate = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(pos + 16);
    if (id === 'data') return byteRate === 0 ? null : Math.round((size / byteRate) * 1000) / 1000;
    pos += 8 + size + (size % 2);
  }
  return null;
}

const DEMO_URL = 'https://gavel.dualmindlab.tech/demo';
const DOCS_URL = 'https://docs.gavel.dualmindlab.tech/docs/judges/open-data';
const SITE_URL = 'https://gavel.dualmindlab.tech';
const DOCS_HOME_URL = 'https://docs.gavel.dualmindlab.tech';
const LICENSE_NAMES = {
  'cc-by-4.0': 'CC-BY-4.0 (Creative Commons Attribution 4.0 International)',
};

const COMMON_FOOTER = (spec, ns) => {
  const name = spec.name;
  const url = `https://huggingface.co/datasets/${ns}/${name}`;
  return [
    '## License',
    '',
    `${LICENSE_NAMES[spec.license] ?? spec.license}. You may copy, adapt and redistribute the data, including commercially, if you credit the project (see Citation). The licence covers the data files in this dataset only; it grants no right to the marks or services of PayPal, Deepgram, Groq or any other third party named in it.`,
    '',
    '## Simulated or real',
    '',
    `Labels: ${spec.labels.join(', ')}. Read the label note at the top of this card before using any number. Nothing here is production data, and no real person or real money is involved.`,
    '',
    '## Citation',
    '',
    '```bibtex',
    `@dataset{gavel_${name.replace(/-/g, '_')}_2026,`,
    `  title  = {${name}},`,
    '  author = {Bhanushali, Harsh},',
    '  year   = {2026},',
    `  url    = {${url}},`,
    `  note   = {Generated from ${REPO_URL}}`,
    '}',
    '```',
    '',
    '## Links',
    '',
    `- Source code, the build in \`scripts/hf\` and the evidence: ${REPO_URL}`,
    `- Project site: ${SITE_URL}`,
    `- Live demo (start a room in the browser, sandbox payments): ${DEMO_URL}`,
    `- Documentation: ${DOCS_HOME_URL}`,
    `- Documentation for this data: ${DOCS_URL}`,
    `- Evidence files on main: ${REPO_URL}/tree/main/docs/evidence`,
    `- Gate verdicts on main: ${REPO_URL}/blob/main/docs/GATES.md`,
    `- Evidence Explorer (charts from these datasets): https://huggingface.co/spaces/${ns}/gavel-evidence-explorer`,
    '',
    '## Contact',
    '',
    `Open an issue at ${REPO_URL}/issues. The code that builds this dataset is in the \`scripts/hf\` folder of that repository.`,
    '',
  ].join('\n');
};

function fieldsSection(tables) {
  const out = ['## Fields', ''];
  for (const t of tables) {
    out.push(`### ${t.file}`, '', t.about, '', '| Field | Type | Meaning |', '| --- | --- | --- |');
    for (const [n, ty, d] of t.fields) out.push(`| \`${n}\` | ${ty} | ${d} |`);
    out.push('');
  }
  return out.join('\n');
}

function provenanceSection(spec) {
  const sha = process.env.GITHUB_SHA ?? '';
  const run =
    process.env.GITHUB_RUN_ID !== undefined && process.env.GITHUB_REPOSITORY !== undefined
      ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '';
  return [
    '## Provenance',
    '',
    sha !== ''
      ? `Built from commit \`${sha}\` of ${REPO_URL}${run !== '' ? ` by ${run}` : ''}. The same values are in \`MANIFEST.json\`.`
      : `Built from ${REPO_URL}; the commit and the build run are recorded in \`MANIFEST.json\` (this copy was built outside CI).`,
    '',
    '`MANIFEST.json` lists the sha256 and size of every file and the row count of every table. `python verify.py` recomputes the hashes and fails on any difference.',
    '',
    ...spec.verify.map((v) => `- ${v}`),
    '',
  ].join('\n');
}

/** Commit date (UTC) of the build commit: deterministic, so two builds of one commit stay equal. */
function repoCommitDate(sha) {
  try {
    return execFileSync('git', ['show', '-s', '--format=%cI', sha], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function card(spec, ns) {
  const sha = repoSha();
  const flag = (name) => spec.labels.includes(name);
  const fm = [
    '---',
    `license: ${spec.license}`,
    'language:',
    '  - en',
    'task_categories:',
    ...spec.taskCategories.map((t) => `  - ${t}`),
    'tags:',
    ...spec.tags.map((t) => `  - ${t}`),
    'size_categories:',
    '  - n<1K',
    `pretty_name: ${spec.title}`,
    `source_repository: ${REPO_URL}`,
    `source_commit: ${sha}`,
    `source_commit_date: ${repoCommitDate(sha)}`,
    `sandbox: ${flag('sandbox') || flag('real sandbox')}`,
    `synthetic: ${flag('synthetic') || flag('synthetic audio') || flag('generated speech')}`,
    `simulated: ${flag('simulated')}`,
    'production_data: false',
    ...(spec.configs ?? []),
    '---',
    '',
  ];
  const body = [
    `# ${spec.title}`,
    '',
    `> Honest labels: ${spec.labels.join(', ')}. ${spec.labelNote}`,
    '',
    '## What it is',
    '',
    spec.what,
    '',
    '## How it was made',
    '',
    spec.how,
    '',
    provenanceSection(spec),
    fieldsSection(spec.tables),
    '## Intended use',
    '',
    spec.intended,
    '',
    '## Limitations',
    '',
    spec.limitations,
    '',
    COMMON_FOOTER(spec, ns),
  ];
  return fm.join('\n') + body.join('\n');
}

// ---------------------------------------------------------------------------------------------
// 1. speech-to-text bids

function sttRows(clipSet, manifest) {
  const dir = clipSet === 'espeak' ? 'stt-cache' : 'stt-cache-human';
  const rows = [];
  for (const provider of ['deepgram', 'groq']) {
    for (const clip of manifest) {
      const file = join(FIXTURES, dir, provider, `${clip.id}.json`);
      const rec = readJson(file);
      const wer = wordErrorRate(clip.text, rec.text);
      rows.push({
        clip_set: clipSet,
        id: clip.id,
        provider,
        model: provider === 'deepgram' ? 'nova-3' : 'whisper-large-v3-turbo',
        reference_text: clip.text,
        provider_text: rec.text,
        latency_ms: rec.latencyMs,
        wer: round2(wer),
        exact_match: wer === 0,
        output_has_digits: /[0-9]/.test(rec.text),
        category: clip.category,
        expected_outcome: clip.expected.outcome,
      });
    }
  }
  return rows;
}

function sttSummary(rows) {
  const out = [];
  for (const clipSet of [...new Set(rows.map((r) => r.clip_set))]) {
    for (const provider of [...new Set(rows.map((r) => r.provider))]) {
      const sel = rows.filter((r) => r.clip_set === clipSet && r.provider === provider);
      const wers = sel.map((r) => r.wer);
      const lat = sel.map((r) => r.latency_ms);
      out.push({
        clip_set: clipSet,
        provider,
        model: sel[0].model,
        clips: sel.length,
        mean_wer: round2(wers.reduce((a, b) => a + b, 0) / sel.length),
        exact_match_rate: round2(sel.filter((r) => r.exact_match).length / sel.length),
        clips_with_digits_in_output: sel.filter((r) => r.output_has_digits).length,
        latency_p50_ms: percentile(lat, 50),
        latency_p95_ms: percentile(lat, 95),
      });
    }
  }
  return out;
}

const STT_PROVIDER_FIELDS = [
  [
    'clip_set',
    'string',
    '`espeak` (robotic synthetic voice) or `human` (human-like synthetic voice)',
  ],
  ['id', 'string', 'Clip id, `a01` to `a24`; joins to the clip table'],
  ['provider', 'string', '`deepgram` or `groq`'],
  ['model', 'string', 'Model name as recorded in the repository fixtures'],
  ['reference_text', 'string', 'What the synthetic voice was asked to say'],
  ['provider_text', 'string', 'What the provider returned'],
  ['latency_ms', 'integer', 'Provider call time measured by the recording run, in milliseconds'],
  ['wer', 'float', 'Word error rate against `reference_text` (lower case, punctuation removed)'],
  ['exact_match', 'boolean', '`wer` equals 0'],
  [
    'output_has_digits',
    'boolean',
    'The provider wrote numerals, which inflates `wer` for spoken amounts',
  ],
  ['category', 'string', 'Utterance category from the manifest'],
  ['expected_outcome', 'string', '`bid`, `confirm` or `none`: what the bid parser should decide'],
];

const STT_SUMMARY_FIELDS = [
  ['clip_set, provider, model', 'string', 'Group keys'],
  ['clips', 'integer', 'Clips in the group'],
  ['mean_wer', 'float', 'Mean word error rate'],
  ['exact_match_rate', 'float', 'Share of clips with `wer` 0'],
  ['clips_with_digits_in_output', 'integer', 'Clips where the provider wrote numerals'],
  [
    'latency_p50_ms, latency_p95_ms',
    'integer',
    'Latency percentiles over the group (nearest rank)',
  ],
];

function buildStt(ctx) {
  const manifest = readJson(join(FIXTURES, 'audio', 'manifest.json'));
  const name = 'gavel-stt-bids';
  const dir = join(ctx.out, name);
  const counts = {};
  mkdirSync(join(dir, 'audio'), { recursive: true });
  const meta = manifest.map((c) => {
    const src = join(FIXTURES, 'audio', 'recordings', `${c.id}.wav`);
    const buf = readFileSync(src);
    copyFileSync(src, join(dir, 'audio', `${c.id}.wav`));
    return {
      file_name: `${c.id}.wav`,
      id: c.id,
      text: c.text,
      category: c.category,
      voice_id: c.voice,
      speaker_bidder_id: c.speakerBidderId ?? null,
      seed: c.seed,
      context_min_increment_cents: c.context.minIncrementCents,
      context_current_price_cents: c.context.currentPriceCents,
      expected_outcome: c.expected.outcome,
      expected_amount_cents: c.expected.amountCents ?? null,
      acceptable_confirm: c.acceptableConfirm,
      duration_s: wavSeconds(buf),
    };
  });
  // metadata.jsonl is the file the Hugging Face audio loader reads; the csv is the same table.
  writeFileSync(join(dir, 'audio', 'metadata.jsonl'), toJsonl(meta));
  writeFileSync(join(dir, 'clips.csv'), toCsv(meta));
  counts['audio/metadata.jsonl'] = meta.length;
  counts['audio/*.wav'] = meta.length;
  const providers = [...sttRows('espeak', manifest), ...sttRows('human', manifest)];
  counts['provider_outputs.jsonl'] = writeTable(dir, 'provider_outputs', providers);
  counts['scores.jsonl'] = writeTable(dir, 'scores', sttSummary(providers));
  writeFileSync(
    join(dir, 'README.md'),
    card(
      {
        name,
        title: 'gavel-stt-bids',
        license: 'cc-by-4.0',
        taskCategories: ['automatic-speech-recognition'],
        tags: [
          'synthetic',
          'tts',
          'espeak-ng',
          'auction',
          'bid-parsing',
          'speech-to-text',
          'gavel',
        ],
        labels: ['synthetic'],
        verify: [
          'The 24 wav files are the committed fixtures `packages/voice/fixtures/audio/recordings/` of the repository at the commit above; `git hash-object` or sha256 of each file there matches `MANIFEST.json`.',
          'Provider outputs are the committed files under `packages/voice/fixtures/stt-cache/` (clip set `espeak`) and `stt-cache-human/` (clip set `human`). Scores are recomputed by `scripts/hf/build-datasets.mjs` from them.',
        ],
        labelNote:
          'All audio is machine-generated speech with no noise added. It is a loop check, not a recording of a real room, and its scores must not be quoted as room accuracy. The `human` clip set is text only: its audio is not published.',
        configs: [
          'configs:',
          '  - config_name: clips',
          '    data_files: audio/**',
          '  - config_name: provider_outputs',
          '    data_files: provider_outputs.jsonl',
        ],
        what: [
          'Twenty-four short utterances of the kind a bidder says in a live auction ("three hundred", "two fifty no wait three hundred", "paddle seven, four hundred"), each with the audio, the intended text, what the bid parser should decide (`bid`, `confirm` or `none`) and the amount, plus the text that two commercial speech-to-text services returned for each clip and a per-clip score.',
          '',
          'A second clip set, `human`, has the same 24 utterances spoken by a human-like synthetic voice. For that set only the provider outputs and scores are published (clip set `human` in `provider_outputs` and `scores`); its audio is left out because the terms for redistributing audio generated by that service on the plan used could not be verified.',
          '',
          'It exists so that anyone can replay the speech-to-text step of a voice-bidding auction without keys or network, and compare services on short numeric speech.',
        ].join('\n'),
        how: [
          '- Audio: rendered in CI by `packages/voice/scripts/render-clips.sh` with eSpeak NG (the Ubuntu package on the GitHub runner at render time; the exact version was not recorded when the clips were rendered), 16 kHz mono PCM, 300 ms of silence either side, speaking rate 150. Five eSpeak voices or variants stand in for the voice ids of the manifest (`en-us`, `en-gb`, `en-gb-x-rp+f3`, `en-us+m3`, `en-us+f2`). No person was recorded.',
          '- Noise: the manifest has `noise` and `snrDb` fields from the original plan. They are NOT applied to these clips and are left out of this dataset.',
          '- `human` clip set (text only): the same utterances spoken by one general-purpose English voice of a commercial text-to-speech service (model `eleven_multilingual_v2`), then sent to the same two providers by the same workflow with `clips=human`. Only provider outputs and scores are published.',
          '- Provider outputs: recorded runs of the `voice-eval` workflow (the option trials of the second round, VOI-02) sent each clip to Deepgram `nova-3` (`punctuate=true`, `smart_format=false`) and Groq `whisper-large-v3-turbo` (a prompt listing bid words, temperature 0) and stored the text and the call time. These replace the first recordings (Deepgram `nova-2`, Groq without a prompt), which scored worse and are only in the repository history. The options were chosen after reading the failures on these same clips, so the scores are in sample. No key and no request header is stored.',
          '- Scores: computed by `scripts/hf/build-datasets.mjs` as word error rate over lower-cased words with punctuation removed. Numerals are not converted to words, so a service that writes "300" for "three hundred" is scored as wrong; `output_has_digits` flags those rows. Parse-level scoring (did the bid parser get the amount right) lives in the repository `voice-eval` job, not here.',
        ].join('\n'),
        tables: [
          {
            file: 'audio/metadata.jsonl and clips.csv',
            about: 'One row per clip. `file_name` points to the wav file in `audio/`.',
            fields: [
              ['file_name', 'string', 'Wav file name inside `audio/`'],
              ['id', 'string', 'Clip id, `a01` to `a24`'],
              ['text', 'string', 'The text the voice was asked to say'],
              [
                'category',
                'string',
                'plain, numeral, colloquial, currency, paddle, two_bidders, correction, ambiguous or non_bid',
              ],
              [
                'voice_id',
                'string',
                'Voice id of the manifest; mapped to an eSpeak voice by the render script',
              ],
              [
                'speaker_bidder_id',
                'string or null',
                'Which fake bidder is speaking (a small integer as text); null when the clip has no known speaker',
              ],
              ['seed', 'integer', 'Seed from the manifest'],
              [
                'context_min_increment_cents',
                'integer',
                'Minimum bid increment of the fake auction, in cents',
              ],
              [
                'context_current_price_cents',
                'integer',
                'Current price of the fake auction, in cents',
              ],
              ['expected_outcome', 'string', '`bid`, `confirm` or `none`'],
              [
                'expected_amount_cents',
                'integer or null',
                'Expected bid amount in cents when the outcome is `bid`',
              ],
              [
                'acceptable_confirm',
                'list (json)',
                'Candidate amounts that are an acceptable confirm prompt',
              ],
              ['duration_s', 'float', 'Clip length in seconds'],
            ],
          },
          {
            file: 'provider_outputs.jsonl / .csv',
            about:
              'One row per clip, provider and clip set (96 rows: 24 clips x 2 providers x 2 clip sets).',
            fields: STT_PROVIDER_FIELDS,
          },
          {
            file: 'scores.jsonl / .csv',
            about: 'One row per clip set and provider (4 rows).',
            fields: STT_SUMMARY_FIELDS,
          },
        ],
        intended:
          'Replaying and regression-testing a speech-to-text and bid-parsing pipeline offline; comparing services on short spoken amounts; teaching examples for numeric speech.',
        limitations: [
          '- Synthetic and clean. Real rooms have noise, accents, crosstalk and microphones; nothing here measures them. n is 24 clips.',
          '- Word error rate penalises numerals and punctuation choices that do not matter for a bid; read it with `output_has_digits`.',
          '- The parser rules and provider options were chosen after reading the failures on these same 24 clips (in sample). The project gate for this accuracy (G5) is PARTIAL, not passed.',
          '- Provider outputs are one recorded run on one day. Services change; the numbers will not reproduce later.',
          "- Licensing of the audio: eSpeak NG is GPL-3.0-or-later software. Speech it synthesizes is generally not treated as a derivative of the program, and this dataset is released under CC-BY-4.0 on that reading. This is the maintainer's interpretation, not legal advice. If you need certainty, render your own clips with `render-clips.sh`.",
          "- Text returned by the two providers is included as recorded output of the maintainer's own API calls on synthetic input.",
        ].join('\n'),
      },
      ctx.ns,
    ),
  );
  return counts;
}

// ---------------------------------------------------------------------------------------------
// 2. simulated 30-day settlement

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const snakeRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [snake(k), v]));

function buildSim(ctx) {
  if (ctx.simDir === '' || !existsSync(join(ctx.simDir, 'lots.jsonl'))) {
    throw new Error('gavel-sim-30d needs --sim-dir with the sim-multiday export (lots.jsonl)');
  }
  const name = 'gavel-sim-30d';
  const dir = join(ctx.out, name);
  const meta = readJson(join(ctx.simDir, 'meta.json'));
  const lots = readJsonl(join(ctx.simDir, 'lots.jsonl')).map((r) => ({
    scenario: 'S8',
    ...snakeRow(r),
    faults: r.faults.join(';'),
  }));
  const holds = readJsonl(join(ctx.simDir, 'holds.jsonl')).map(snakeRow);
  const scenarios = readJsonl(join(ctx.simDir, 'scenarios.jsonl')).map(snakeRow);
  const counts = {};
  counts['lots.jsonl'] = writeTable(dir, 'lots', lots);
  counts['holds.jsonl'] = writeTable(dir, 'holds', holds);
  counts['scenarios.jsonl'] = writeTable(dir, 'scenarios', scenarios);
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify({ ...meta, simulated: true }, null, 2) + '\n',
  );
  writeFileSync(
    join(dir, 'README.md'),
    card(
      {
        name,
        title: 'gavel-sim-30d',
        license: 'cc-by-4.0',
        taskCategories: ['tabular-classification', 'other'],
        tags: [
          'simulated',
          'synthetic',
          'payments',
          'settlement',
          'auction',
          'authorization-hold',
          'fake-clock',
          'gavel',
        ],
        labels: ['simulated', 'synthetic'],
        verify: [
          'Re-run workflow `sim-multiday` (`.github/workflows/sim-multiday.yml`) with the repository at the commit above and `SIM_EXPORT_DIR` set; the suite is deterministic (it asserts that two runs are equal), so `lots.jsonl` and `holds.jsonl` come out byte for byte the same.',
          '`docs/evidence/SIM/SIM-MULTIDAY.md` in the repository is the human-readable report of the same suite and is checked by CI against the generated one.',
        ],
        labelNote:
          'Every row comes from a simulation with a fake clock against a model of PayPal, not from PayPal and not from real buyers.',
        configs: [
          'configs:',
          '  - config_name: lots',
          '    data_files: lots.jsonl',
          '  - config_name: holds',
          '    data_files: holds.jsonl',
          '  - config_name: scenarios',
          '    data_files: scenarios.jsonl',
        ],
        what: [
          'The settlement of 40 simulated auction lots over 30 simulated days, with 100 fake bidders, random process crashes and injected payment faults. Per lot: how many holds were placed, who won and at what price, whether it settled or went to review and why, and where every cent of every hold ended up (captured, released or still open). One row per hold in a second table, and a table of the eight simulation scenarios with their check counts.',
          '',
          'It shows that a card-hold-based auction settlement keeps its books balanced (no double capture, no lost hold, held equals captured plus released plus open) under crashes, restarts, outages and rate limiting.',
        ].join('\n'),
        how: [
          `- Produced by the \`sim-multiday\` suite (\`packages/payments/test/simdays\`, scenario S8, seed ${meta.seed}) which runs the real settlement code (saga, reauthorization pass, journals, webhook merge) against the fake PayPal in \`packages/payments/src/fake\`. A fake clock starts at ${meta.startIso}; days are simulated days. Nothing waits in real time.`,
          '- The fake follows these assumptions: authorization honor period 3 days, validity 29 days, reauthorization allowed only after the honor period. They are assumptions about PayPal, not measurements; the repository documents which ones the sandbox has confirmed.',
          '- Every fifth lot ("storm") gets two injected HTTP 429 answers on its first capture and a restart after a 2-hour outage. Other lots get random faults (declined capture, timeouts, 5xx, connection resets), a 3 percent chance of a crash at each saga boundary and, in 5 percent of crashes, an outage of 1 to 4 days.',
          '- The export is test-only code in the suite (`SIM_EXPORT_DIR`). The same run is reproducible: two runs give identical rows.',
        ].join('\n'),
        tables: [
          {
            file: 'lots.jsonl / .csv',
            about: 'One row per lot (40 rows).',
            fields: [
              ['scenario', 'string', 'Always `S8`, the 30-day soak scenario'],
              ['lot_id', 'string', 'Fake lot id'],
              ['close_day', 'float', 'Simulated day (since day 0) when the auction closed'],
              ['holds', 'integer', 'Holds placed on the lot'],
              ['storm', 'boolean', 'Lot got the injected 429 storm on its first capture'],
              ['status', 'string', '`settled` or `review` (ended in the review state)'],
              ['journal_state', 'string', 'Final state of the settlement journal'],
              ['sold', 'boolean', 'A winner was charged'],
              ['winner_bidder', 'string or null', 'Fake bidder id of the winner'],
              ['winner_cents', 'integer or null', 'Winning price in integer cents'],
              [
                'runner_up_fallback',
                'boolean',
                'The first winner failed and a runner-up was tried',
              ],
              ['crashes', 'integer', 'Simulated process crashes survived'],
              ['passes', 'integer', 'Saga passes needed'],
              ['down_days', 'float', 'Total simulated downtime in days'],
              ['review_cause', 'string or null', 'Why the lot is in review; null when settled'],
              ['faults', 'string', 'Injected faults as `call:kind`, separated by semicolons'],
              ['held_cents', 'integer', 'Sum of the hold ceilings'],
              ['captured_cents', 'integer', 'Cents captured'],
              ['released_cents', 'integer', 'Cents released back (voided or expired)'],
              ['open_cents', 'integer', 'Cents still held after the final expiry sweep'],
            ],
          },
          {
            file: 'holds.jsonl / .csv',
            about: 'One row per hold.',
            fields: [
              ['hold_id', 'string', 'Fake hold id'],
              ['lot_id', 'string', 'Lot of the hold'],
              ['bidder', 'string', 'Fake bidder id, `b001` to `b100`'],
              ['ceiling_cents', 'integer', 'Amount held, in cents'],
              ['opened_day', 'float', 'Simulated day the hold was opened'],
              ['captured_cents', 'integer', 'Cents captured from this hold'],
              ['released_cents', 'integer', 'Cents released'],
              ['open_cents', 'integer', 'Cents still held'],
              [
                'authorizations_in_chain',
                'integer',
                'Authorizations in the reauthorization chain (1 means never reauthorized)',
              ],
            ],
          },
          {
            file: 'scenarios.jsonl / .csv',
            about: 'One row per simulation scenario S1 to S8.',
            fields: [
              ['scenario', 'string', 'Scenario id'],
              ['title', 'string', 'What the scenario does'],
              ['checks', 'integer', 'Checks in the scenario'],
              ['checks_passed', 'integer', 'Checks that passed'],
            ],
          },
          {
            file: 'run.json',
            about: 'Run constants and totals.',
            fields: [
              [
                'seed, start_iso and totals',
                'mixed',
                'Seed, fake-clock start and the counters the suite reports',
              ],
            ],
          },
        ],
        intended:
          'Studying settlement and reconciliation behaviour, reviewing failure causes, testing reconciliation or anomaly-detection code, and as a worked example of an invariant-checked payment saga.',
        limitations: [
          '- Simulated. The payment provider is a model written from assumptions; real PayPal may behave differently, which is why the repository also runs a real-sandbox probe.',
          '- 40 lots and one seed; no real buyers, no real money, no real names. Bidder and lot ids are fake labels.',
          '- Faults and crash rates are chosen by the author, not measured from production, so the share of lots in review is not a failure rate of any real system.',
          '- The clock is simulated; durations in days say nothing about real latency.',
        ].join('\n'),
      },
      ctx.ns,
    ),
  );
  return counts;
}

// ---------------------------------------------------------------------------------------------
// 3. latency (real sandbox, small n)

function buildLatency(ctx) {
  const name = 'gavel-latency';
  const dir = join(ctx.out, name);
  const gatesText = readFileSync(join(ROOT, 'docs', 'GATES.md'), 'utf8');
  const latency = loadLatencyRuns(ROOT, gatesText);
  if (latency.settlements.length === 0) throw new Error('no settlement runs under docs/evidence');
  if (latency.calls.length === 0) throw new Error('no per-call run under docs/evidence/latency');
  const { spanRows, callRows } = latencyRows(latency);
  const runs = latency.settlements;
  const latest = runs[runs.length - 1];
  const callsRun = latency.calls[latency.calls.length - 1];
  const spanOf = (id, span) => spanRows.find((r) => String(r.run_id) === id && r.span === span);
  const latestVerdict = ['hammer_to_captured', 'hammer_to_settled']
    .map((span) => spanOf(latest.id, span))
    .map(
      (r) =>
        `${r.span.replace(/_/g, ' ')} p95 ${r.p95_ms} ms against ${r.target_p95_ms} ms: ${r.status} (${r.n} of ${r.attempts} completed)`,
    )
    .join('; ');
  const failureNotes = [...spanRows, ...callRows]
    .filter((r) => r.failures > 0)
    .map(
      (r) =>
        `run ${r.run_id} ${r.span ?? r.call}: ${r.failures} of ${r.attempts} attempts failed or timed out`,
    );
  const counts = {};
  counts['settlement_spans.jsonl'] = writeTable(dir, 'settlement_spans', spanRows);
  counts['api_calls.jsonl'] = writeTable(dir, 'api_calls', callRows);
  const url = (id) => `${REPO_URL}/actions/runs/${id}`;
  writeFileSync(
    join(dir, 'README.md'),
    card(
      {
        name,
        title: 'gavel-latency',
        license: 'cc-by-4.0',
        taskCategories: ['tabular-regression', 'other'],
        tags: ['sandbox', 'latency', 'payments', 'paypal-sandbox', 'benchmark', 'small-n', 'gavel'],
        labels: ['sandbox'],
        verify: [
          `Run pages (GitHub sign-in with access to the repository may be needed, and logs expire): ${[...new Set([...runs.map((r) => r.id), callsRun.id])].map(url).join(', ')}. Every row has a \`source_path\`: the redacted summary committed in the repository (\`docs/evidence/latency\` and \`docs/evidence/measure\`) that the row was reshaped from; compare the numbers.`,
          'The same numbers are recorded in `docs/GATES.md` of the repository.',
        ],
        labelNote: `Measured against the PayPal sandbox, not production, and with few samples. Sandbox latency is not production latency. Latest run (${latest.id}): ${latestVerdict}. Read \`status\` and \`met\` per row; a row with failures is never \`MET\`.`,
        configs: [
          'configs:',
          '  - config_name: settlement_spans',
          '    data_files: settlement_spans.jsonl',
          '  - config_name: api_calls',
          '    data_files: api_calls.jsonl',
        ],
        what: [
          'Latency of the payment calls an auction settlement makes, measured against the real PayPal sandbox: the time from the hammer to the winner being captured, from the hammer to the whole settlement being finished (winner captured, every other hold released), and the per-call latency of order, authorize, capture and void.',
          '',
          'The tables hold summary statistics (min, p50, p95, p99, max in milliseconds, attempt and failure counts). The raw per-call samples were not kept by the measuring job. Percentiles are over the attempts that completed; `p95_all_attempts_ms` counts every failed or timed-out attempt as the worst case.',
        ].join('\n'),
        how: [
          `- Settlement spans: ${runs.map((r) => `run ${url(r.id)} (${r.report.settlements} settlements, ${r.report.hammerToSettled.count} timed, source \`${r.path}\`)`).join(' and ')}. Each settlement has ${runs[0].report.holdsPerSettlement} holds, one winner, and voids five holds three at a time. A sandbox buyer approves every order in a browser; the approval is not timed.`,
          `- API calls: run ${url(callsRun.id)}, ${callsRun.report.cycles} sequential cycles (source \`${callsRun.path}\`). The same numbers are in \`docs/GATES.md\` of the repository.`,
          '- The measuring job uploads numbers only (counts, milliseconds, status counts). The build script reads the redacted summaries committed under `docs/evidence` directly and only reshapes them; there are no hand-copied inputs. The targets are the ones in `docs/GATES.md` and are never changed to fit a result.',
        ].join('\n'),
        tables: [
          {
            file: 'settlement_spans.jsonl / .csv',
            about: `One row per run and span (${spanRows.length} rows).`,
            fields: [
              ['run_id', 'integer', 'GitHub Actions run id'],
              ['run_label', 'string', 'Settlements attempted in the run, e.g. `50 settlements`'],
              ['run_date', 'string or null', 'Date of the run (UTC), from `docs/GATES.md`'],
              ['span', 'string', '`hammer_to_captured` or `hammer_to_settled`'],
              ['n', 'integer', 'Settlements that completed and are in the percentiles'],
              [
                'failures',
                'integer',
                'Settlements that failed or timed out (not in the percentiles)',
              ],
              ['attempts', 'integer', '`n` plus `failures`'],
              [
                'p95_all_attempts_ms',
                'float or null',
                'p95 over all attempts with every failure counted as the worst case; an upper bound read from the summary, null when a failed attempt sits at the 95th percentile (unbounded)',
              ],
              ['target_p95_ms', 'integer', 'Target for this span from `docs/GATES.md`'],
              [
                'met, status',
                'boolean, string',
                '`MET`, `MISSED` or `UNPROVEN` (target met on the completed attempts but some attempts failed, so not met)',
              ],
              [
                'min_ms, p50_ms, p95_ms, p99_ms, max_ms',
                'float',
                'Latency statistics in milliseconds over the completed attempts',
              ],
              ['holds_per_settlement', 'integer', 'Holds per settlement'],
              ['void_concurrency', 'integer', 'Voids in flight at a time'],
              ['mismatches, errors', 'integer', 'Ledger mismatches and errors reported by the run'],
              ['source_path', 'string', 'Committed evidence file the row was reshaped from'],
            ],
          },
          {
            file: 'api_calls.jsonl / .csv',
            about: `One row per run and PayPal call type (${callRows.length} rows).`,
            fields: [
              ['run_id, run_date', 'integer, string or null', 'Run and date'],
              ['call', 'string', '`order`, `authorize`, `capture` or `void`'],
              ['n', 'integer', 'Calls that completed and are in the percentiles'],
              ['failures', 'integer', 'Calls that failed'],
              ['attempts, cycles', 'integer', '`n` plus `failures`; sequential cycles in the run'],
              [
                'p95_all_attempts_ms',
                'float or null',
                'p95 with every failed call counted as the worst case (bound; null = unbounded)',
              ],
              [
                'target_p95_ms, met, status',
                'integer, boolean, string',
                'Per-call p95 budget and whether it was met (`MET`, `MISSED`, `UNPROVEN`)',
              ],
              [
                'min_ms, p50_ms, p95_ms, p99_ms, max_ms',
                'float',
                'Latency statistics in milliseconds over the completed calls',
              ],
              ['source_path', 'string', 'Committed evidence file the row was reshaped from'],
            ],
          },
        ],
        intended:
          'Sizing timeouts and retry budgets for payment flows, sanity-checking latency targets, and as a reference point for how slow a sandbox payment provider can be.',
        limitations: [
          '- Sandbox only, from a GitHub-hosted runner, at one time of day. Production will differ.',
          `- Small n: ${runs.map((r) => `${r.report.settlements} settlements`).join(' and ')}, ${callRows[0].cycles} call cycles. Treat percentiles as indicative, not as service-level numbers.`,
          failureNotes.length === 0
            ? '- No run in this dataset had failed or timed-out attempts.'
            : `- Failed or timed-out attempts are not in the percentiles (${failureNotes.join('; ')}). They are usually the slowest attempts, so the reported p95 can understate the tail; use \`p95_all_attempts_ms\` and \`status\`.`,
          '- Only runs whose redacted summaries are committed under `docs/evidence` are included. A 3-settlement pilot (run 42346020463) and a 10-cycle per-call run (42047543821) were never committed as evidence files; `docs/GATES.md` still records them.',
          '- Summary statistics only; no per-sample data.',
          '- The sandbox rate limits shaped how the runs were paced.',
        ].join('\n'),
      },
      ctx.ns,
    ),
  );
  return counts;
}

// ---------------------------------------------------------------------------------------------
// 4. audit demo (anonymised scenario traces)

const AMOUNT_KEYS = ['amount', 'ceiling'];

function anonymiser() {
  const map = new Map();
  return (actor) => {
    if (actor === undefined || actor === null) return null;
    if (actor === 'auctioneer') return 'auctioneer';
    if (!map.has(actor)) map.set(actor, `bidder_${String.fromCharCode(97 + map.size)}`);
    return map.get(actor);
  };
}

function readNdjson(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

function buildAudit(ctx) {
  if (ctx.traceDir === '' || !existsSync(ctx.traceDir)) {
    throw new Error('gavel-audit-demo needs --trace-dir with the e2e scenario traces');
  }
  const files = readdirSync(ctx.traceDir)
    .filter((f) => f.endsWith('.ndjson'))
    .sort();
  if (files.length === 0) throw new Error(`no .ndjson traces in ${ctx.traceDir}`);
  const name = 'gavel-audit-demo';
  const dir = join(ctx.out, name);
  const events = [];
  const outcomes = [];
  const ledger = [];
  const rejections = [];
  for (const file of files) {
    const trace = readNdjson(join(ctx.traceDir, file));
    const start = trace.find((e) => e.kind === 'start');
    const result = trace.find((e) => e.kind === 'result');
    if (start === undefined || result === undefined) throw new Error(`${file}: no start or result`);
    const scenario = String(start.data.id).split('-')[0];
    const who = anonymiser();
    let clock = 0;
    for (const e of trace) {
      if (e.kind === 'start' || e.kind === 'result') continue;
      // The webhook summary step is recorded at time 0 by the runner; it carries the time of the step before it.
      clock = Math.max(clock, e.t);
      const d = e.data;
      const row = {
        scenario,
        seq: e.n,
        t_ms: clock,
        kind: e.kind,
        action: d.do ?? null,
        actor: who(d.actor ?? d.bidder ?? d.fault?.bidder),
        amount_cents: typeof d.amount === 'number' ? d.amount : null,
        ceiling_cents: typeof d.ceiling === 'number' ? d.ceiling : null,
        fault_at: d.fault?.at ?? d.at ?? null,
        fault_kind: d.fault?.kind ?? d.kind ?? null,
        detail: JSON.stringify(
          Object.fromEntries(
            Object.entries(d).filter(
              ([k]) =>
                !['do', 'actor', 'bidder', 'fault', ...AMOUNT_KEYS].includes(k) &&
                k !== 'at' &&
                k !== 'kind',
            ),
          ),
        ),
      };
      events.push(row);
    }
    const o = result.data;
    outcomes.push({
      scenario,
      seed: start.data.seed,
      winner: who(o.winner),
      price_cents: o.priceCents,
      captured_cents: o.capturedCents,
      released_cents: o.releasedCents,
      voided: (o.voided ?? []).map((a) => who(a)).join(';'),
      bids_accepted: o.accepted,
      bids_rejected: (o.rejected ?? []).length,
      paypal_capture_calls: o.paypalCalls?.capture ?? 0,
      paypal_void_calls: o.paypalCalls?.void ?? 0,
      paypal_reauthorize_calls: o.paypalCalls?.reauthorize ?? 0,
      crashes: o.crashes,
      restarts: o.restarts,
      webhooks_delivered: o.webhooks?.delivered ?? 0,
      webhooks_duplicate: o.webhooks?.duplicates ?? 0,
      soft_close_extensions: o.softClose?.extensions ?? 0,
      final_auction_state: o.settlement?.auction ?? null,
      invariant_i1: o.invariants?.I1 === true,
      invariant_i2: o.invariants?.I2 === true,
      invariant_i3: o.invariants?.I3 === true,
      invariant_i4: o.invariants?.I4 === true,
      invariant_i5: o.invariants?.I5 === true,
    });
    (o.ledgerTypes ?? []).forEach((type, i) => {
      ledger.push({ scenario, seq: i, event_type: type });
    });
    for (const r of o.rejected ?? []) {
      rejections.push({ scenario, actor: who(r.actor), reason_code: r.code });
    }
  }
  const counts = {};
  counts['events.jsonl'] = writeTable(dir, 'events', events);
  counts['outcomes.jsonl'] = writeTable(dir, 'outcomes', outcomes);
  counts['ledger_events.jsonl'] = writeTable(dir, 'ledger_events', ledger);
  counts['rejections.jsonl'] = writeTable(dir, 'rejections', rejections);
  writeFileSync(
    join(dir, 'README.md'),
    card(
      {
        name,
        title: 'gavel-audit-demo',
        license: 'cc-by-4.0',
        taskCategories: ['tabular-classification', 'other'],
        tags: [
          'synthetic',
          'simulated',
          'audit-log',
          'event-sourcing',
          'auction',
          'ledger',
          'anonymised',
          'gavel',
        ],
        labels: ['synthetic', 'simulated'],
        verify: [
          'Check out the repository at the commit above, run the in-process runner as the workflow `hf-datasets` does (`scripts/hf/run-traces.mjs`) and rebuild with `node scripts/hf/build-datasets.mjs`; seeds are fixed, so the rows match.',
        ],
        labelNote:
          'Records of scripted demo auctions run by the repository end-to-end tests against a fake payment provider. No real people, no real money.',
        configs: [
          'configs:',
          '  - config_name: events',
          '    data_files: events.jsonl',
          '  - config_name: outcomes',
          '    data_files: outcomes.jsonl',
          '  - config_name: ledger_events',
          '    data_files: ledger_events.jsonl',
          '  - config_name: rejections',
          '    data_files: rejections.jsonl',
        ],
        what: [
          `Event, ledger and outcome records of ${files.length} scripted auction scenarios (happy path, voice replay, crash and resume, duplicate and out-of-order webhooks, runner-up fallback, voided and expired holds, reconnects, last-100-ms race, soft close, capture and void failures, restart with a persisted ledger). For each: the timed steps taken (registrations, bids, hammer, faults), what happened (winner, price, captured and released cents, payment-provider calls, rejected bids with reason codes) and the ledger event types the engine wrote.`,
          '',
          'It documents the audit trail of a hold-then-capture auction: bids, rejections, holds, captures, voids and timestamps.',
        ].join('\n'),
        how: [
          '- The repository end-to-end scenarios (`packages/e2e/scenarios/*.yaml`) are run in CI by the in-process runner (`packages/e2e/src/runner/cli.ts --trace`) against the real auction engine, room and settlement code and the fake PayPal server, on a manual clock that starts at a fixed instant. Each scenario has a fixed seed, so the run is reproducible.',
          '- The NDJSON traces of those runs are reshaped by `scripts/hf/build-datasets.mjs`. Actor names from the scenario files are replaced by `bidder_a`, `bidder_b` and so on per scenario (the auctioneer stays `auctioneer`). Timestamps are milliseconds from the start of the scenario clock, not wall-clock times.',
          '- Ids that the runs generate (auction, hold, order, authorization, request ids) are not exported at all. A privacy scan of every output file (emails, tokens, key-like strings, payment-object-like ids) must pass before the dataset is built or published.',
        ].join('\n'),
        tables: [
          {
            file: 'events.jsonl / .csv',
            about: 'One row per scripted step or injected fault.',
            fields: [
              ['scenario', 'string', 'Scenario id, for example `S01`'],
              ['seq', 'integer', 'Order in the trace'],
              [
                't_ms',
                'integer',
                'Milliseconds from the scenario start (fake clock); the webhook summary row carries the time of the step before it',
              ],
              ['kind', 'string', '`step` or `fault`'],
              [
                'action',
                'string or null',
                'register, open, bid, hammer, restart, webhooks and others',
              ],
              ['actor', 'string or null', 'Anonymised actor'],
              ['amount_cents', 'integer or null', 'Bid amount in integer cents'],
              ['ceiling_cents', 'integer or null', 'Hold ceiling in integer cents (registration)'],
              [
                'fault_at, fault_kind',
                'string or null',
                'Where a fault was injected and what kind',
              ],
              ['detail', 'string (json)', 'Remaining fields of the step'],
            ],
          },
          {
            file: 'outcomes.jsonl / .csv',
            about: 'One row per scenario with the end result.',
            fields: [
              ['scenario, seed', 'string, integer', 'Scenario id and seed'],
              [
                'winner, price_cents',
                'string or null, integer or null',
                'Anonymised winner and winning price',
              ],
              ['captured_cents, released_cents', 'integer', 'Money captured and released'],
              [
                'voided',
                'string',
                'Anonymised bidders whose hold was voided, separated by semicolons',
              ],
              ['bids_accepted, bids_rejected', 'integer', 'Bid counts'],
              [
                'paypal_capture_calls, paypal_void_calls, paypal_reauthorize_calls',
                'integer',
                'Calls to the fake payment provider',
              ],
              ['crashes, restarts', 'integer', 'Simulated process deaths and restarts'],
              ['webhooks_delivered, webhooks_duplicate', 'integer', 'Webhook deliveries'],
              ['soft_close_extensions', 'integer', 'Times the soft close moved the end'],
              [
                'final_auction_state',
                'string or null',
                'Last settlement state, for example SETTLED',
              ],
              [
                'invariant_i1, invariant_i2, invariant_i3, invariant_i4, invariant_i5',
                'boolean',
                'The five ledger invariants: I1 at most one capture, I2 nothing captured above the winner ceiling, I3 every loser hold voided and never captured, I4 held money equals captured plus released, I5 the ledger hash chain verifies. I3 can read false where no winner emerges; each scenario asserts only the invariants that apply to it',
              ],
            ],
          },
          {
            file: 'ledger_events.jsonl / .csv',
            about: 'The ledger event types the engine wrote, in order, per scenario.',
            fields: [
              ['scenario', 'string', 'Scenario id'],
              ['seq', 'integer', 'Position in the ledger'],
              ['event_type', 'string', 'Ledger event type, for example BID_ACCEPTED'],
            ],
          },
          {
            file: 'rejections.jsonl / .csv',
            about: 'One row per rejected bid.',
            fields: [
              ['scenario', 'string', 'Scenario id'],
              ['actor', 'string or null', 'Anonymised bidder'],
              ['reason_code', 'string', 'Rejection reason code of the engine'],
            ],
          },
        ],
        intended:
          'Teaching and testing audit, reconciliation and anomaly-detection tooling for auction or hold-and-capture payment flows; examples of event-sourced ledgers.',
        limitations: [
          '- Scripted, not organic: the steps are written by the author to exercise edge cases, so frequencies say nothing about real auctions.',
          '- The payment provider is a fake. No real PayPal object, buyer, name or email exists in the data.',
          '- Only scenarios the in-process runner can drive are included (the abusive-input scenario S10 needs raw frames and is driven by another harness, so it is not here). Some details (generated ids, exact payloads) are deliberately left out.',
          '- Time is a fake clock in milliseconds from scenario start.',
        ].join('\n'),
      },
      ctx.ns,
    ),
  );
  return counts;
}

// ---------------------------------------------------------------------------------------------
// 5. gates: a small evidence index (no copies of docs or evidence files)

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function repoSha() {
  if (process.env.GITHUB_SHA !== undefined && process.env.GITHUB_SHA !== '')
    return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const GATE_META = {
  G0: { method: 'real sandbox', label: 'real sandbox' },
  G1: { method: 'real sandbox', label: 'real sandbox' },
  G2: { method: 'real sandbox', label: 'real sandbox' },
  G3: { method: 'real sandbox probe over several real days', label: 'real sandbox' },
  G4: { method: 'real sandbox webhooks', label: 'real sandbox' },
  G5: {
    method: 'cached evaluation of recorded provider outputs on synthetic speech',
    label: 'generated speech',
  },
};

export function parseGates(text) {
  const parts = text.split(/^## (G\d): /m);
  const gates = [];
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i];
    const body = parts[i + 1];
    const title = body.split('\n', 1)[0].trim();
    const section = body.split(/^## /m)[0];
    const one = (re) => (re.exec(section) ?? [])[1]?.trim() ?? null;
    const status = one(/^Status: (.*)$/m);
    const runLine = one(/^Run date \/ by: (.*)$/m) ?? '';
    const decisionLine = one(/^Decision: (.*)$/m) ?? '';
    const evidence = [...section.matchAll(/^Evidence: (.*)$/gm)].map((m) => m[1]);
    gates.push({
      id,
      title,
      status,
      runLine,
      decision: (/^(PASS|FAIL|PARTIAL|n\/a)/.exec(decisionLine) ?? [null])[0],
      evidencePaths: [
        ...new Set(
          evidence.flatMap((e) =>
            [...e.matchAll(/docs\/evidence\/[A-Za-z0-9_./-]*[A-Za-z0-9_]/g)].map((m) => m[0]),
          ),
        ),
      ],
      claimed: Object.fromEntries(
        evidence.flatMap((e) => {
          const m = /(docs\/evidence\/\S+\.jsonl?) \(sha256 ([0-9a-f]{64})\)/.exec(e);
          return m ? [[m[1], m[2]]] : [];
        }),
      ),
      runIds: [
        ...new Set(
          [...(runLine + ' ' + evidence.join(' ')).matchAll(/\brun (\d{8,})/g)].map((m) => m[1]),
        ),
      ],
    });
  }
  return gates;
}

function buildGates(ctx) {
  const name = 'gavel-gates';
  const dir = join(ctx.out, name);
  const sha = repoSha();
  const blob = (p) => `${REPO_URL}/blob/${sha}/${p}`;
  const gatesText = readFileSync(join(ROOT, 'docs', 'GATES.md'), 'utf8');
  const gates = parseGates(gatesText);
  if (gates.length !== 6)
    throw new Error(`expected gates G0 to G5 in docs/GATES.md, found ${gates.length}`);
  // Every file under docs/evidence, any extension, one row each (issue 2322).
  const files = walkEvidence(ROOT);
  const claims = parseClaims(gatesText, files);
  const fileRows = files.map((p) => {
    const digest = sha256File(join(ROOT, p));
    const claimed = claims.get(p) ?? null;
    return {
      gate: evidenceGroup(p),
      path: p,
      bytes: readFileSync(join(ROOT, p)).length,
      sha256: digest,
      sha256_claimed_in_gates_md:
        claimed === null ? null : claimed.includes(digest) ? digest : claimed[0],
      matches_claim: claimed === null ? null : claimed.includes(digest),
      url_at_commit: blob(p),
    };
  });
  const gateRows = gates.map((g) => {
    const meta = GATE_META[g.id];
    const { status, note } = gateStatus(g);
    const own = fileRows.filter((f) => f.gate === g.id).map((f) => f.path);
    const cited = g.evidencePaths.filter((p) => files.includes(p));
    return {
      gate: g.id,
      title: g.title,
      status,
      status_note: note,
      decision: g.decision,
      date_utc: parseDate(g.runLine),
      method: meta.method,
      label: status === 'IN PROGRESS' ? `${meta.label}, in progress` : meta.label,
      workflow_run_urls: g.runIds.map((id) => `${REPO_URL}/actions/runs/${id}`).join(';'),
      evidence_files: [...new Set([...own, ...cited])].sort().join(';'),
      gates_doc_url: blob('docs/GATES.md'),
    };
  });
  const g3 = gateRows.find((r) => r.gate === 'G3');
  const g3Line =
    g3.status === 'IN PROGRESS'
      ? 'G3 is a real multi-day probe that is still running.'
      : g3.status === 'PASS'
        ? 'G3 passed: the multi-day probe is finished and docs/GATES.md records PASS (final probe 12 Nov 2026).'
        : `G3 status in docs/GATES.md at build time: ${g3.status}.`;
  const nightlyDir = join(ROOT, 'docs', 'evidence', 'nightly');
  const nightly = [];
  for (const f of readdirSync(nightlyDir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const j = readJson(join(nightlyDir, f));
    const runId = /NIGHTLY-(\d+)\.json/.exec(f)?.[1] ?? null;
    for (const sp of j.specs) {
      nightly.push({
        run_id: runId,
        run_url: runId === null ? null : `${REPO_URL}/actions/runs/${runId}`,
        generated_at: j.generatedAt,
        built_from_sha: j.sha,
        spec: sp.spec,
        gate: sp.gate,
        status: sp.status,
        observed: sp.observed,
        finished_at: sp.finishedAt,
      });
    }
  }
  const counts = {};
  counts['gates.jsonl'] = writeTable(dir, 'gates', gateRows);
  counts['evidence_files.jsonl'] = writeTable(dir, 'evidence_files', fileRows);
  counts['nightly_results.jsonl'] = writeTable(dir, 'nightly_results', nightly);
  const hasAssurance = ctx.assurance !== '' && existsSync(ctx.assurance);
  if (hasAssurance)
    counts['assurance.jsonl'] = writeTable(dir, 'assurance', readJsonl(ctx.assurance));
  writeFileSync(
    join(dir, 'README.md'),
    card(
      {
        name,
        title: 'gavel-gates',
        license: 'cc-by-4.0',
        taskCategories: ['other'],
        tags: ['evidence', 'sandbox', 'payments', 'verification', 'checksums', 'gavel'],
        labels: [
          'real sandbox',
          'generated speech',
          ...(g3.status === 'IN PROGRESS' ? ['in progress'] : []),
        ],
        labelNote: `Gates G0 to G4 ran against the real PayPal sandbox, never against live money. G5 is a cached evaluation of recorded provider outputs. ${g3Line}`,
        verify: [
          'Every row of `evidence_files` gives the repository path, the sha256 and a link to the file at the build commit. Download the file from that link, run `sha256sum`, compare. `matches_claim` says whether the hash equals the one written in `docs/GATES.md`.',
          'Assurance rows carry a `query_url`; opening it in GitHub (with repository access) shows the same count as the row.',
          'Rows with `workflow_run_urls` point to GitHub Actions runs; open them (repository access may be needed and logs expire) to confirm date and result.',
          'The evidence files themselves are not copied here; they are committed redacted in the repository.',
        ],
        configs: [
          'configs:',
          '  - config_name: gates',
          '    data_files: gates.jsonl',
          '  - config_name: evidence_files',
          '    data_files: evidence_files.jsonl',
          '  - config_name: nightly_results',
          '    data_files: nightly_results.jsonl',
        ],
        what: [
          'A small machine-readable index of the six go/no-go experiments ("gates", G0 to G5) that decided which payment and voice features the project turns on: for each gate its status, date, method and honest label, the workflow runs and evidence files behind it, with a sha256 and a link for every evidence file; plus the per-spec results of the nightly sandbox runs.',
          '',
          'It is an index, not a copy: the narrative and the evidence files live in the repository.',
        ].join('\n'),
        how: [
          '- `gates` is parsed by `scripts/hf/build-datasets.mjs` from the status lines of `docs/GATES.md`; nothing is overridden in code. A gate whose status line says NOT RUN while its run line starts with IN PROGRESS (a probe still running) reads `IN PROGRESS`, and `status_note` quotes the run line; once GATES.md records a result, the dataset shows that result.',
          '- `evidence_files` has one row for every file under `docs/evidence` (all extensions, all folders), hashed at build time. Where `docs/GATES.md` writes a sha256 next to a file name, `matches_claim` says whether it equals the computed hash; otherwise it is null.',
          '- `nightly_results` reshapes the committed nightly reports (`docs/evidence/nightly/NIGHTLY-<run id>.json`).',
        ].join('\n'),
        tables: [
          {
            file: 'gates.jsonl / .csv',
            about: 'One row per gate (6 rows).',
            fields: [
              ['gate', 'string', '`G0` to `G5`'],
              ['title', 'string', 'Short title'],
              ['status', 'string', '`PASS`, `FAIL`, `PARTIAL`, `NOT RUN` or `IN PROGRESS`'],
              [
                'status_note',
                'string or null',
                'Extra note when the status is derived (IN PROGRESS)',
              ],
              ['decision', 'string or null', 'Recorded decision keyword'],
              [
                'date_utc',
                'string or null',
                "First date or timestamp on the gate's run line in `docs/GATES.md` (G3: start of the probe)",
              ],
              ['method', 'string', 'How the gate was run'],
              ['label', 'string', 'Honest label: real sandbox, generated speech'],
              ['workflow_run_urls', 'string', 'GitHub Actions run URLs, separated by semicolons'],
              [
                'evidence_files',
                'string',
                'Evidence paths in the repository, separated by semicolons',
              ],
              ['gates_doc_url', 'string', 'Link to `docs/GATES.md` at the build commit'],
            ],
          },
          {
            file: 'evidence_files.jsonl / .csv',
            about: 'One row per evidence file.',
            fields: [
              [
                'gate',
                'string',
                'Gate (`G0` to `G5`, `G3-early` belongs to `G3`) or the evidence folder (`nightly`, `latency`, `measure`, `hosted`, ...)',
              ],
              ['path', 'string', 'Path in the repository'],
              ['bytes, sha256', 'integer, string', 'Size and sha256 at the build commit'],
              [
                'sha256_claimed_in_gates_md',
                'string or null',
                'Hash written in `docs/GATES.md`, if any',
              ],
              ['matches_claim', 'boolean or null', 'Computed hash equals the claimed one'],
              ['url_at_commit', 'string', 'Link to the file at the build commit'],
            ],
          },
          ...(hasAssurance
            ? [
                {
                  file: 'assurance.jsonl / .csv',
                  about:
                    'Aggregate counts of the red-team and audit findings of the repository, from the GitHub issues API. Counts only: no issue title, text or author is stored. The query is pinned to issues (not pull requests) carrying at least one of the labels red-team, audit-r1, audit-r2 or redteam-r4; severity rows are for the red-team label and include an `unlabelled` row (red-team findings with no severity label), so they add up to the red-team count; area labels overlap (an issue can carry several), so area rows can add up to more than the population, and the `unlabelled` area row counts findings with no area label.',
                  fields: [
                    ['dimension', 'string', '`overall`, `label`, `severity` or `area`'],
                    ['key', 'string', 'Label, severity or area the row counts'],
                    [
                      'found, closed, open',
                      'integer',
                      'Findings, how many are closed and how many are still open',
                    ],
                    ['closed_rate', 'float', 'closed divided by found'],
                    [
                      'median_hours_to_close',
                      'float or null',
                      'Median hours from opening to closing of the closed issues; a proxy for time to fix, not a measured fix time',
                    ],
                    [
                      'query_url',
                      'string',
                      'GitHub issue search that reproduces the count (repository access is needed to open it)',
                    ],
                    ['as_of_utc', 'string', 'Date the counts were taken'],
                  ],
                },
              ]
            : []),
          {
            file: 'nightly_results.jsonl / .csv',
            about: 'One row per spec per nightly report.',
            fields: [
              ['run_id, run_url', 'string', 'Nightly workflow run'],
              ['generated_at, finished_at', 'string', 'Timestamps (UTC)'],
              ['built_from_sha', 'string', 'Short commit the nightly ran on'],
              ['spec, gate', 'string', 'Spec id and gate'],
              ['status', 'string', 'pass, fail, inconclusive or skipped'],
              ['observed', 'string', 'One-line observation'],
            ],
          },
        ],
        intended:
          'Letting a reader check, in a few minutes, which claims about the payment and voice features rest on real sandbox runs, which on simulation, and what is still open.',
        limitations: [
          "- Status lines are the maintainer's own record. The index proves that a file existed with a given hash at a commit, not that the file is true; for that, follow the run links.",
          '- Evidence files without a sha256 in `docs/GATES.md` have `matches_claim` null: the hash is computed but there is nothing to compare it with. G5 also relies on recorded provider outputs and the fixtures of the other dataset.',
          '- Sandbox only. Nothing here says how production PayPal behaves.',
          `- ${g3Line}${g3.status === 'IN PROGRESS' ? ' It is incomplete by design until the multi-day probe finishes.' : ''}`,
        ].join('\n'),
      },
      ctx.ns,
    ),
  );
  return counts;
}

// ---------------------------------------------------------------------------------------------

const BUILDERS = {
  'gavel-stt-bids': buildStt,
  'gavel-gates': buildGates,
  'gavel-sim-30d': buildSim,
  'gavel-latency': buildLatency,
  'gavel-audit-demo': buildAudit,
};

export function main(argv) {
  const args = parseArgs(argv);
  const ctx = {
    out: resolve(args.out),
    simDir: args.simDir === '' ? '' : resolve(args.simDir),
    traceDir: args.traceDir === '' ? '' : resolve(args.traceDir),
    assurance: args.assurance === '' ? '' : resolve(args.assurance),
    ns:
      process.env.HF_NAMESPACE !== undefined && process.env.HF_NAMESPACE !== ''
        ? process.env.HF_NAMESPACE
        : '<namespace>',
  };
  const names = args.dataset === 'all' ? DATASETS : [args.dataset];
  mkdirSync(ctx.out, { recursive: true });
  const summary = {};
  for (const name of names) {
    summary[name] = BUILDERS[name](ctx);
    process.stdout.write(`built ${name}: ${JSON.stringify(summary[name])}\n`);
  }
  writeFileSync(join(ctx.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
