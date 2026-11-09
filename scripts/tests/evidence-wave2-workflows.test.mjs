// Guards for the SEC-15 log scan, live voice socket and a11y emulation evidence workflows
// (issues 2188, 2194, 2195): dispatch only, secrets only through env, a verdict line (or an
// uploaded report), pinned actions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const files = ['evidence-log-scan.yml', 'evidence-voice-live-socket.yml'];

describe('evidence wave 2 workflows', () => {
  for (const name of files) {
    const text = readFileSync(`.github/workflows/${name}`, 'utf8');
    it(`${name} is dispatch only with read-only permissions`, () => {
      assert.match(text, /^on:\n {2}workflow_dispatch:/m);
      assert.doesNotMatch(text, /^ {2}(push|pull_request|schedule):/m);
      assert.match(text, /^permissions:\n {2}contents: read$/m);
    });
    it(`${name} prints a verdict line and uploads an artifact`, () => {
      assert.match(text, /VERDICT/);
      assert.match(text, /actions\/upload-artifact@[0-9a-f]{40}/);
    });
    it(`${name} pins every action to a commit`, () => {
      for (const m of text.matchAll(/uses: (\S+)/g)) {
        const ref = m[1];
        if (ref.startsWith('./')) continue;
        assert.match(ref, /@[0-9a-f]{40}$/, ref);
      }
    });
    it(`${name} passes secrets only through env`, () => {
      for (const line of text.split('\n')) {
        if (/\$\{\{ secrets\./.test(line) && !/^\s*#/.test(line)) {
          assert.match(line, /^\s+[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/, line);
        }
      }
    });
  }

  it('the log scan uses no secrets and runs a negative control', () => {
    const text = readFileSync('.github/workflows/evidence-log-scan.yml', 'utf8');
    assert.doesNotMatch(text, /\$\{\{ secrets\./);
    assert.match(text, /Negative control/);
    assert.match(text, /::add-mask::/);
  });

  it('the live voice run is from main and ends NOT RUN without a key', () => {
    const text = readFileSync('.github/workflows/evidence-voice-live-socket.yml', 'utf8');
    assert.match(text, /github\.ref == 'refs\/heads\/main'/);
    const cli = readFileSync('packages/e2e/src/voice/live-socket-cli.ts', 'utf8');
    assert.match(cli, /VOICE LIVE SOCKET VERDICT: NOT RUN/);
    assert.match(text, /GROQ_API_KEY: \$\{\{ secrets\.GROQ_API_KEY \}\}/);
    assert.match(text, /DEEPGRAM_API_KEY: \$\{\{ secrets\.DEEPGRAM_API_KEY \}\}/);
  });
});
