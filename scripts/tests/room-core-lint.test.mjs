// T-RT-097 guard: the root ESLint config must apply the room-core block to the room and shared sources.
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { describe, it } from 'node:test';

describe('room-core lint is wired into the root config', () => {
  for (const file of ['packages/server/src/room/room.ts', 'packages/shared/src/ids.ts']) {
    it(`${file} forbids Date.now, Math.random and node: imports`, async () => {
      const eslint = new ESLint();
      const config = await eslint.calculateConfigForFile(file);
      assert.equal(config.rules['gavel/no-real-time']?.[0], 2);
      assert.equal(config.rules['gavel/no-random']?.[0], 2);
      assert.equal(config.rules['no-restricted-imports']?.[0], 2);
    });
  }
});
