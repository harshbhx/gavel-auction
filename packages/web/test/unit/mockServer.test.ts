import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../src/net/transport';
import { ScenarioTransport } from '../../src/net/scenarioTransport';
import type { ServerMessage } from '../../src/wire';
import { happy } from '../../src/testing/scenarios/happy';
import { applyFaultToScenario, faultToWire, parseFaultBody } from '../../mock/faults';

function collectMessages(scenario: Scenario): ServerMessage[] {
  const transport = new ScenarioTransport(scenario);
  const messages: ServerMessage[] = [];
  transport.onMessage((m) => messages.push(m));
  transport.connect();
  const maxAt = scenario.steps.reduce((m, s) => Math.max(m, s.at), 0);
  transport.advance(maxAt + 5_000);
  transport.close();
  return messages;
}

function lastOfType<T extends ServerMessage['t']>(
  msgs: ServerMessage[],
  t: T,
): Extract<ServerMessage, { t: T }> | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m !== undefined && m.t === t) return m as Extract<ServerMessage, { t: T }>;
  }
  return undefined;
}

describe('Fault injection matrix (T-WEB-063)', () => {
  const cleanMessages = collectMessages(happy);
  const cleanFinal = lastOfType(cleanMessages, 'settlement_update');

  it('clean happy scenario reaches settlement', () => {
    expect(cleanFinal).toBeDefined();
    expect(cleanFinal?.settlement.phase).toBe('CAPTURED');
  });

  it('fault "drop" delivers no messages', () => {
    const faulted = applyFaultToScenario(happy, 'drop');
    const messages = collectMessages(faulted);
    expect(messages.length).toBe(0);
  });

  it('fault "dup" delivers same final settlement as clean run', () => {
    const faulted = applyFaultToScenario(happy, 'dup');
    const messages = collectMessages(faulted);
    expect(messages.length).toBeGreaterThan(cleanMessages.length);
    const faultedFinal = lastOfType(messages, 'settlement_update');
    expect(faultedFinal).toBeDefined();
    expect(faultedFinal?.settlement.phase).toBe(cleanFinal?.settlement.phase);
    expect(faultedFinal?.settlement.winnerPaddle).toBe(cleanFinal?.settlement.winnerPaddle);
  });

  it('fault "reorder" delivers all settlement phases', () => {
    const faulted = applyFaultToScenario(happy, 'reorder');
    const messages = collectMessages(faulted);
    const phases = messages
      .filter(
        (m): m is Extract<ServerMessage, { t: 'settlement_update' }> => m.t === 'settlement_update',
      )
      .map((m) => m.settlement.phase);
    const cleanPhases = cleanMessages
      .filter(
        (m): m is Extract<ServerMessage, { t: 'settlement_update' }> => m.t === 'settlement_update',
      )
      .map((m) => m.settlement.phase);
    expect(new Set(phases)).toEqual(new Set(cleanPhases));
  });

  it('fault "disconnect" delivers at most as many messages as clean run', () => {
    const faulted = applyFaultToScenario(happy, 'disconnect');
    const messages = collectMessages(faulted);
    expect(messages.length).toBeLessThanOrEqual(cleanMessages.length);
  });

  it('fault "delay:1500" delivers same final settlement as clean run', () => {
    const faulted = applyFaultToScenario(happy, 'delay:1500');
    const messages = collectMessages(faulted);
    const faultedFinal = lastOfType(messages, 'settlement_update');
    expect(faultedFinal).toBeDefined();
    expect(faultedFinal?.settlement.phase).toBe(cleanFinal?.settlement.phase);
    expect(faultedFinal?.settlement.winnerPaddle).toBe(cleanFinal?.settlement.winnerPaddle);
  });
});

describe('parseFaultBody', () => {
  it('parses drop', () => {
    expect(parseFaultBody('drop')).toEqual({ kind: 'drop' });
  });

  it('parses dup', () => {
    expect(parseFaultBody('dup')).toEqual({ kind: 'dup' });
  });

  it('parses reorder', () => {
    expect(parseFaultBody('reorder')).toEqual({ kind: 'reorder' });
  });

  it('parses disconnect', () => {
    expect(parseFaultBody('disconnect')).toEqual({ kind: 'disconnect' });
  });

  it('parses delay:<ms>', () => {
    expect(parseFaultBody('delay:1500')).toEqual({ kind: 'delay', ms: 1500 });
  });

  it('returns null for invalid input', () => {
    expect(parseFaultBody('bogus')).toBeNull();
    expect(parseFaultBody('delay:abc')).toBeNull();
  });
});

describe('faultToWire', () => {
  it('converts drop to wire', () => {
    expect(faultToWire({ kind: 'drop' })).toBe('drop');
  });

  it('converts delay to wire', () => {
    expect(faultToWire({ kind: 'delay', ms: 2000 })).toBe('delay:2000');
  });
});

describe('applyFaultToScenario', () => {
  it('applies fault to all emitting steps', () => {
    const faulted = applyFaultToScenario(happy, 'dup');
    const withEmit = faulted.steps.filter((s) => s.emit !== undefined);
    expect(withEmit.length).toBeGreaterThan(0);
    for (const step of withEmit) {
      expect(step.fault).toBe('dup');
    }
  });

  it('preserves scenario metadata', () => {
    const faulted = applyFaultToScenario(happy, 'drop');
    expect(faulted.name).toBe(happy.name);
    expect(faulted.description).toBe(happy.description);
    expect(faulted.roomConfig).toBe(happy.roomConfig);
  });
});
