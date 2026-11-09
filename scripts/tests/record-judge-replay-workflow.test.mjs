// Guards for the judge-room replay recording workflow (inventory row 41): dispatch only, no
// secrets, pinned actions, a verdict line, and the recording says its holds are simulated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const text = readFileSync('.github/workflows/record-judge-replay.yml', 'utf8');

describe('record-judge-replay workflow', () => {
  it('is dispatch only with read-only permissions and no secrets', () => {
    assert.match(text, /^on:\n {2}workflow_dispatch:/m);
    assert.doesNotMatch(text, /^ {2}(push|pull_request|schedule):/m);
    assert.match(text, /^permissions:\n {2}contents: read$/m);
    assert.doesNotMatch(text, /\$\{\{ secrets\./);
  });
  it('pins every action to a commit', () => {
    for (const m of text.matchAll(/uses: (\S+)/g)) {
      if (m[1].startsWith('./')) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
    }
  });
  it('prints a verdict line and uploads the recording', () => {
    assert.match(text, /REPLAY RECORDING VERDICT/);
    assert.match(text, /actions\/upload-artifact@[0-9a-f]{40}/);
  });
  it('labels the recording as simulated in the workflow and in the bundle', () => {
    assert.match(text, /SIMULATED/);
    const lib = readFileSync('packages/e2e/src/replay/judge-recording.ts', 'utf8');
    assert.match(lib, /simulatedHolds: true/);
    assert.match(lib, /no PayPal call was made and no money moved/);
  });
  it('records into the path the web replay route fetches', () => {
    const cli = readFileSync('packages/e2e/src/replay/record-judge-room-cli.ts', 'utf8');
    assert.match(cli, /'recordings', id/);
    const screen = readFileSync('packages/web/src/screens/replay/ReplayScreen.tsx', 'utf8');
    assert.match(screen, /\/recordings\/\$\{encodeURIComponent\(recordingId\)\}\/events\.json/);
  });
});
