import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { ZodIssue } from 'zod';
import { ScenarioSchema, toScenario } from './schema';
import type { Scenario } from './types';

export class ScenarioError extends Error {
  readonly issues: string[];
  constructor(source: string, issues: string[]) {
    super(`invalid scenario ${source}:\n  ${issues.join('\n  ')}`);
    this.name = 'ScenarioError';
    this.issues = issues;
  }
}

/** Renders a path such as ['steps', 3, 'amount'] as "steps[3].amount". */
function formatPath(path: ReadonlyArray<string | number>): string {
  let out = '';
  for (const part of path) {
    out += typeof part === 'number' ? `[${part}]` : out === '' ? part : `.${part}`;
  }
  return out === '' ? '(root)' : out;
}

function formatIssue(issue: ZodIssue): string {
  return `${formatPath(issue.path)}: ${issue.message}`;
}

/** Validates an already-parsed object. Errors name the offending step index. */
export function validateScenario(raw: unknown, source = '<inline>'): Scenario {
  const result = ScenarioSchema.safeParse(raw);
  if (!result.success) {
    throw new ScenarioError(source, result.error.issues.map(formatIssue));
  }
  return toScenario(result.data);
}

export function parseScenarioYaml(text: string, source = '<inline>'): Scenario {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScenarioError(source, [`yaml: ${msg}`]);
  }
  return validateScenario(raw, source);
}

export function loadScenarioFile(path: string): Scenario {
  return parseScenarioYaml(readFileSync(path, 'utf8'), path);
}
