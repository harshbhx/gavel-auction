import { readFileSync } from 'node:fs';

// Report builder (R-QA-032, R-QA-020): folds per-layer result files into the summary schema
// and renders the static page. A missing layer is omitted from the JSON and shown as n/a.

export interface Counted {
  total: number;
  passed: number;
  cases?: number;
  flaky?: number;
  lastRun?: string;
}

export interface LoadResult {
  p95AckMs?: number;
  lostBids?: number;
  scripts?: number;
}

export interface MatrixRow {
  id: string;
  inproc?: string;
  chromium?: string;
  firefox?: string;
  webkit?: string;
}

export interface ReportInputs {
  sha: string;
  builtAt: string;
  layers?: {
    unit?: Counted;
    property?: Counted;
    contract?: Counted;
    scenario?: Counted;
    e2e?: Counted;
    sandbox?: Counted;
    load?: LoadResult;
  };
  coverage?: Record<string, { lines: number; branches: number }>;
  scenarioMatrix?: MatrixRow[];
  invariants?: Record<string, number>;
  mutation?: Record<string, number>;
}

export interface Summary {
  sha: string;
  builtAt: string;
  layers: NonNullable<ReportInputs['layers']>;
  coverage: Record<string, { lines: number; branches: number }>;
  scenarioMatrix: MatrixRow[];
  invariants: Record<string, number>;
  mutation: Record<string, number>;
  warnings: string[];
}

export interface Target {
  layer: string;
  label: string;
  min: number;
}

// Target counts at submission (R-QA-020). Unit and property tests share one target.
export const TARGETS: readonly Target[] = [
  { layer: 'unit+property', label: 'L1 unit and property', min: 600 },
  { layer: 'contract', label: 'L2 contract', min: 60 },
  { layer: 'scenario', label: 'L3 scenario', min: 40 },
  { layer: 'e2e', label: 'L4 e2e browser', min: 14 },
  { layer: 'sandbox', label: 'L5 real sandbox', min: 8 },
  { layer: 'load', label: 'L6 load and race scripts', min: 4 },
];

type Layers = NonNullable<ReportInputs['layers']>;

/** Count for a target, or undefined when none of its layers reported. */
export function countFor(layers: Layers, layer: string): number | undefined {
  if (layer === 'unit+property') {
    if (layers.unit === undefined && layers.property === undefined) return undefined;
    return (layers.unit?.total ?? 0) + (layers.property?.total ?? 0);
  }
  if (layer === 'load') return layers.load?.scripts;
  if (layer === 'contract' || layer === 'scenario' || layer === 'e2e' || layer === 'sandbox') {
    return layers[layer]?.total;
  }
  return undefined;
}

export function buildSummary(input: ReportInputs): Summary {
  const layers: Layers = input.layers ?? {};
  const warnings: string[] = [];
  for (const t of TARGETS) {
    const n = countFor(layers, t.layer);
    if (n === undefined) continue;
    if (n < t.min) warnings.push(`${t.label}: ${n} is under the target of ${t.min}`);
  }
  return {
    sha: input.sha,
    builtAt: input.builtAt,
    layers,
    coverage: input.coverage ?? {},
    scenarioMatrix: input.scenarioMatrix ?? [],
    invariants: input.invariants ?? {},
    mutation: input.mutation ?? {},
    warnings,
  };
}

// Minimal JSON Schema subset check (type, required, properties, additionalProperties, items,
// enum, minimum, minLength, $ref to #/definitions). Returns a list of problems.
type Json = unknown;
type Obj = Record<string, Json>;

function isObj(v: Json): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeOk(type: string, v: Json): boolean {
  if (type === 'object') return isObj(v);
  if (type === 'array') return Array.isArray(v);
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeof v === type;
}

function check(schema: Obj, root: Obj, v: Json, path: string, out: string[]): void {
  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    const target = ref.startsWith('#/definitions/')
      ? (root['definitions'] as Obj)[ref.slice('#/definitions/'.length)]
      : undefined;
    if (isObj(target)) check(target, root, v, path, out);
    else out.push(`${path}: unresolved ref ${ref}`);
    return;
  }
  const type = schema['type'];
  if (typeof type === 'string' && !typeOk(type, v)) {
    out.push(`${path}: expected ${type}`);
    return;
  }
  const en = schema['enum'];
  if (Array.isArray(en) && !en.includes(v)) out.push(`${path}: not one of the allowed values`);
  const min = schema['minimum'];
  if (typeof min === 'number' && typeof v === 'number' && v < min) out.push(`${path}: below ${min}`);
  const minLen = schema['minLength'];
  if (typeof minLen === 'number' && typeof v === 'string' && v.length < minLen) {
    out.push(`${path}: too short`);
  }
  if (isObj(v)) {
    const props = isObj(schema['properties']) ? schema['properties'] : {};
    const required = Array.isArray(schema['required']) ? schema['required'] : [];
    for (const key of required) {
      if (typeof key === 'string' && !(key in v)) out.push(`${path}.${key}: missing`);
    }
    const extra = schema['additionalProperties'];
    for (const [key, val] of Object.entries(v)) {
      const sub = props[key];
      if (isObj(sub)) check(sub, root, val, `${path}.${key}`, out);
      else if (extra === false) out.push(`${path}.${key}: not allowed`);
      else if (isObj(extra)) check(extra, root, val, `${path}.${key}`, out);
    }
  }
  const items = schema['items'];
  if (Array.isArray(v) && isObj(items)) {
    v.forEach((item, i) => check(items, root, item, `${path}[${i}]`, out));
  }
}

export function loadSchema(): Obj {
  const parsed: Json = JSON.parse(
    readFileSync(new URL('./schema.json', import.meta.url), 'utf8'),
  );
  if (!isObj(parsed)) throw new Error('report schema is not an object');
  return parsed;
}

export function validateSummary(summary: Json): string[] {
  const schema = loadSchema();
  const out: string[] = [];
  check(schema, schema, summary, '$', out);
  return out;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function table(head: string[], rows: string[][]): string {
  const th = head.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function na(n: number | undefined): string {
  return n === undefined ? 'n/a' : String(n);
}

export function renderHtml(summary: Summary, template: string): string {
  const layerRows = TARGETS.map((t) => {
    const n = countFor(summary.layers, t.layer);
    const status = n === undefined ? 'n/a' : n >= t.min ? 'met' : 'under target';
    return [t.label, na(n), String(t.min), status];
  });
  const load = summary.layers.load;
  if (load !== undefined) {
    layerRows.push([
      'Load results',
      `p95 ack ${na(load.p95AckMs)} ms`,
      '',
      `lost bids ${na(load.lostBids)}`,
    ]);
  }
  const sandbox = summary.layers.sandbox;
  if (sandbox?.lastRun !== undefined) {
    layerRows.push(['Sandbox last run', sandbox.lastRun, '', '']);
  }
  const cov = Object.entries(summary.coverage).map(([pkg, c]) => [
    pkg,
    String(c.lines),
    String(c.branches),
  ]);
  const matrix = summary.scenarioMatrix.map((r) => [
    r.id,
    r.inproc ?? 'n/a',
    r.chromium ?? 'n/a',
    r.firefox ?? 'n/a',
    r.webkit ?? 'n/a',
  ]);
  const inv = Object.entries(summary.invariants).map(([k, v]) => [k, String(v)]);
  const mut = Object.entries(summary.mutation).map(([k, v]) => [k, String(v)]);
  const parts: Record<string, string> = {
    SHA: esc(summary.sha),
    BUILT_AT: esc(summary.builtAt),
    LAYERS: table(['Layer', 'Count', 'Target', 'Status'], layerRows),
    COVERAGE: cov.length ? table(['Package', 'Lines %', 'Branches %'], cov) : '<p>n/a</p>',
    MATRIX: matrix.length
      ? table(['Scenario', 'inproc', 'chromium', 'firefox', 'webkit'], matrix)
      : '<p>n/a</p>',
    INVARIANTS: inv.length ? table(['Invariant', 'Checks run'], inv) : '<p>n/a</p>',
    MUTATION: mut.length ? table(['Target', 'Score %'], mut) : '<p>n/a</p>',
    WARNINGS: summary.warnings.length
      ? `<ul>${summary.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
      : '<p>none</p>',
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => parts[key] ?? m);
}

export function loadTemplate(): string {
  return readFileSync(new URL('./template.html', import.meta.url), 'utf8');
}
