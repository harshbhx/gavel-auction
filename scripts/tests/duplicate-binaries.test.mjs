import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNewDuplicates, MIN_BYTES } from '../check-duplicate-binaries.mjs';

const big = MIN_BYTES + 1;
const e = (oid, path, size = big) => ({ oid, path, size });

test('flags a new twin', () => {
  const r = findNewDuplicates([e('a', 'x/1.gif'), e('a', 'y/1.gif')], new Set());
  assert.deepEqual(r, [['x/1.gif', 'y/1.gif']]);
});
test('allows listed groups, flags a new member', () => {
  const allowed = new Set(['x/1.gif', 'y/1.gif']);
  assert.deepEqual(findNewDuplicates([e('a', 'x/1.gif'), e('a', 'y/1.gif')], allowed), []);
  const three = [e('a', 'x/1.gif'), e('a', 'y/1.gif'), e('a', 'z/1.gif')];
  assert.equal(findNewDuplicates(three, allowed).length, 1);
});
test('ignores small files and baselines', () => {
  assert.deepEqual(findNewDuplicates([e('a', 'x', 10), e('a', 'y', 10)], new Set()), []);
  const shots = [e('a', 'p/__screenshots__/a.png'), e('a', 'q/__screenshots__/a.png')];
  assert.deepEqual(findNewDuplicates(shots, new Set()), []);
});
