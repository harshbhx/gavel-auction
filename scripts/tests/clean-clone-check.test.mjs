// QA-76: the clean-clone check flags each kind of problem and passes a good file list.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkCleanClone, isEnvFile } from '../clean-clone-check.mjs';

const good = ['LICENSE', 'README.md', '.env.example', 'docs/PUBLIC-REPO-CHECKLIST.md', 'docs/JUDGES.md'];
const readme = '# GAVEL\n\n## Run it\n\n```\nnpm ci\n```\n';

describe('clean clone check', () => {
  it('passes a good clone', () => {
    assert.deepEqual(checkCleanClone({ files: good, readme }), []);
  });
  it('flags a missing LICENSE and missing docs', () => {
    const files = good.filter((f) => f !== 'LICENSE' && f !== 'docs/JUDGES.md');
    const p = checkCleanClone({ files, readme });
    assert.equal(p.length, 2);
  });
  it('flags a README without run instructions', () => {
    assert.equal(checkCleanClone({ files: good, readme: '# GAVEL\n' }).length, 1);
  });
  it('flags tracked env and key files but not .env.example', () => {
    const files = [...good, '.env', 'packages/server/.env.local', 'certs/server.pem'];
    assert.equal(checkCleanClone({ files, readme }).length, 3);
    assert.equal(isEnvFile('.env.example'), false);
  });
});
