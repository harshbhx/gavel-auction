import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mode } from '../types.js';

export type StepOp =
  | 'register'
  | 'bid'
  | 'tick'
  | 'hammer'
  | 'promote'
  | 'revoke'
  | 'complete'
  | 'abort'
  | 'pause'
  | 'resume'
  | 'extend';
const OPS: readonly StepOp[] = [
  'register',
  'bid',
  'tick',
  'hammer',
  'promote',
  'revoke',
  'complete',
  'abort',
  'pause',
  'resume',
  'extend',
];
const MODES: readonly Mode[] = ['english', 'proxy', 'second_price'];

export interface Step {
  op: StepOp;
  at: number;
  bidder?: string;
  amount?: number;
  ceiling?: number;
}

export interface FixtureConfig {
  mode: Mode;
  reserve?: number;
  minIncrement?: number;
  endTs?: number;
  softCloseWindow?: number;
  softCloseExtension?: number;
  maxExtensions?: number;
}

export interface Expect {
  winner?: string | null;
  price?: number;
  ranking?: Array<[string, number]>;
  rejects?: string[];
  endsAt?: number;
}

export type Fixture = {
  name: string;
  parity: boolean;
  config: FixtureConfig;
  steps: Step[];
  expect: Expect;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseFixture(raw: unknown, file: string): Fixture {
  const fail = (m: string): never => {
    throw new Error(`${file}: ${m}`);
  };
  if (!isObj(raw)) return fail('fixture must be an object');
  if (typeof raw['name'] !== 'string' || raw['name'] === '')
    fail('name must be a non-empty string');
  if (typeof raw['parity'] !== 'boolean') fail('parity must be a boolean');
  const config = raw['config'];
  if (!isObj(config) || !MODES.includes(config['mode'] as Mode)) fail('config.mode is invalid');
  const steps = raw['steps'];
  if (!Array.isArray(steps)) return fail('steps must be an array');
  steps.forEach((s: unknown, i) => {
    if (!isObj(s)) return fail(`step ${i} must be an object`);
    if (!OPS.includes(s['op'] as StepOp)) fail(`step ${i} has unknown op ${String(s['op'])}`);
    if (!Number.isInteger(s['at'])) fail(`step ${i} needs integer at`);
  });
  if (!isObj(raw['expect']) || Object.keys(raw['expect']).length === 0) {
    fail('expect must be a non-empty object');
  }
  return raw as unknown as Fixture;
}

export function loadFixtures(dir: string): Fixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'SCHEMA.json')
    .sort()
    .map((f) => parseFixture(JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown, f));
}
