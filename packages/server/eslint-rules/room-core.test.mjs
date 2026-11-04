// T-RT-097: the room core config rejects node:* imports, Date.now and Math.random.
import { ESLint } from 'eslint';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import roomCore from './room-core.js';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      plugins: roomCore.plugins,
      rules: roomCore.rules,
      files: ['**/*.js'],
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
  ],
});

async function ruleIds(code) {
  const [res] = await eslint.lintText(code, { filePath: 'sample.js' });
  return res.messages.map((m) => m.ruleId);
}

describe('room core lint (R-RT-140, R-RT-151)', () => {
  it('rejects node: imports', async () => {
    assert.deepEqual(await ruleIds("import fs from 'node:fs';"), ['no-restricted-imports']);
  });
  it('rejects Date.now', async () => {
    assert.deepEqual(await ruleIds('const t = Date.now();'), ['gavel/no-real-time']);
  });
  it('rejects Math.random', async () => {
    assert.deepEqual(await ruleIds('const x = Math.random();'), ['gavel/no-random']);
  });
  it('accepts Clock and Ids use', async () => {
    assert.deepEqual(await ruleIds('const t = clock.now(); const i = ids.mint();'), []);
  });
  it('targets the room core and shared sources', () => {
    assert.ok(roomCore.files.includes('packages/server/src/room/**/*.ts'));
    assert.ok(roomCore.files.includes('packages/shared/src/**/*.ts'));
  });
});
