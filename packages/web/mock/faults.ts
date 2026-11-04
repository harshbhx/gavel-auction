import type { Fault, Scenario, ScenarioStep } from '../src/net/transport';

export type FaultSpec =
  | { kind: 'drop' }
  | { kind: 'dup' }
  | { kind: 'reorder' }
  | { kind: 'disconnect' }
  | { kind: 'delay'; ms: number };

export function faultToWire(spec: FaultSpec): Fault {
  if (spec.kind === 'delay') return `delay:${spec.ms}`;
  return spec.kind;
}

export function parseFaultBody(body: string): FaultSpec | null {
  const trimmed = body.trim();
  if (trimmed === 'drop') return { kind: 'drop' };
  if (trimmed === 'dup') return { kind: 'dup' };
  if (trimmed === 'reorder') return { kind: 'reorder' };
  if (trimmed === 'disconnect') return { kind: 'disconnect' };
  if (trimmed.startsWith('delay:')) {
    const ms = Number(trimmed.slice('delay:'.length));
    if (Number.isFinite(ms) && ms >= 0) return { kind: 'delay', ms };
  }
  return null;
}

export function applyFaultToScenario(scenario: Scenario, fault: Fault): Scenario {
  const steps: ScenarioStep[] = scenario.steps.map((step) => {
    if (step.emit === undefined) return step;
    return { ...step, fault };
  });
  return { ...scenario, steps };
}
