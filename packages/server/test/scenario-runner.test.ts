import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseScenario, runScenario, type ScenarioResult } from '../src/testing/scenario-runner';

const load = (file: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./scenarios/${file}`, import.meta.url)), 'utf8'));

const play = async (name: string): Promise<{ got: ScenarioResult; golden: ScenarioResult }> => ({
  got: await runScenario(parseScenario(load(`${name}.json`))),
  golden: load(`${name}.golden.json`) as ScenarioResult,
});

/** The golden names the clients and views it pins; other clients are not compared. */
const expectGolden = (got: ScenarioResult, golden: ScenarioResult): void => {
  for (const [client, frames] of Object.entries(golden.frames)) {
    expect(got.frames[client]).toEqual(frames);
  }
  for (const [client, view] of Object.entries(golden.views)) {
    expect(got.views[client]).toEqual(view);
  }
};

describe('scenario runner', () => {
  it('T-RT-103 happy-path-english matches its golden transcript', async () => {
    const { got, golden } = await play('happy-path-english');
    expect(got.events).toEqual(golden.events);
    expectGolden(got, golden);
    expect(got.events.at(-1)).toContain('settlement_update:SETTLED');
  });

  it('T-RT-104 same-ms-tie resolves by arrival order', async () => {
    const { got, golden } = await play('same-ms-tie');
    expect(got.events).toEqual(golden.events);
    expectGolden(got, golden);
  });

  it('T-RT-105 reconnect-mid-auction ends with the same view as its peers', async () => {
    const { got, golden } = await play('reconnect-mid-auction');
    expect(got.events).toEqual(golden.events);
    expectGolden(got, golden);
    expect(got.views.ada).toEqual(got.views.host);
    expect(got.views.ada).toEqual(got.views.cy);
  });

  it('rejects a malformed scenario', () => {
    expect(() => parseScenario({ name: 'x', bidders: [], steps: [] })).toThrow();
    expect(() =>
      parseScenario({
        name: 'x',
        bidders: [{ key: 'a', name: 'A', ceiling: 1 }],
        steps: [{ op: 'nope' }],
      }),
    ).toThrow();
  });
});
