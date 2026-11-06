import { describe, expect, it } from 'vitest';
import { boundaryFromEnv, checkpointBoundary, parseCheckpoint } from '../src/boot/checkpoint-kill';

describe('GAVEL_CHECKPOINT_KILL', () => {
  it('knows the six checkpoints and nothing else', () => {
    for (const name of [
      'after_winner_selected',
      'before_capture_request',
      'after_capture_request_before_response',
      'after_capture_recorded',
      'during_void_loop:2',
      'before_final_ledger',
    ]) {
      expect(parseCheckpoint(name)).toBe(name);
    }
    for (const bad of [
      undefined,
      '',
      'nope',
      'during_void_loop',
      'during_void_loop:0',
      'toString',
    ]) {
      expect(parseCheckpoint(bad)).toBeNull();
    }
  });

  it('kills once, at the label of its checkpoint', async () => {
    let kills = 0;
    const boundary = checkpointBoundary('before_capture_request', () => void (kills += 1));
    await boundary('journaled:hammer');
    expect(kills).toBe(0);
    await boundary('before:capture');
    await boundary('before:capture');
    expect(kills).toBe(1);
  });

  it('counts voids for the void loop checkpoint', async () => {
    let kills = 0;
    const boundary = checkpointBoundary('during_void_loop:2', () => void (kills += 1));
    await boundary('before:void');
    await boundary('after:void');
    expect(kills).toBe(0);
    await boundary('after:void');
    expect(kills).toBe(1);
  });

  it('is off when unset, rejects a bad name and refuses production', () => {
    const kill = (): void => undefined;
    expect(boundaryFromEnv({}, kill)).toBeUndefined();
    expect(boundaryFromEnv({ GAVEL_CHECKPOINT_KILL: '' }, kill)).toBeUndefined();
    expect(() => boundaryFromEnv({ GAVEL_CHECKPOINT_KILL: 'later' }, kill)).toThrow(/unknown/);
    expect(() =>
      boundaryFromEnv(
        { GAVEL_CHECKPOINT_KILL: 'after_capture_recorded', NODE_ENV: 'production' },
        kill,
      ),
    ).toThrow(/production/);
    expect(boundaryFromEnv({ GAVEL_CHECKPOINT_KILL: 'after_capture_recorded' }, kill)).toBeTypeOf(
      'function',
    );
  });

  it('refuses on a public https host even when NODE_ENV is unset', () => {
    const kill = (): void => undefined;
    const env = { GAVEL_CHECKPOINT_KILL: 'before_capture_request' };
    expect(() =>
      boundaryFromEnv(env, kill, {
        NODE_ENV: 'development',
        PUBLIC_URL: 'https://auction.example.org',
      }),
    ).toThrow(/public host/);
    expect(() =>
      boundaryFromEnv({ ...env, PUBLIC_URL: 'https://auction.example.org' }, kill),
    ).toThrow(/public host/);
    expect(
      boundaryFromEnv(env, kill, { NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:8080' }),
    ).toBeTypeOf('function');
  });
});
