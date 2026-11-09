// Guards for the manual evidence workflows: dispatch only, protected environment, no secret
// values on the command line, a verdict line and an uploaded artifact.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const names = ['evidence-latency.yml', 'gate-g4-tamper.yml'];

describe('evidence workflows', () => {
  for (const name of names) {
    const text = readFileSync(`.github/workflows/${name}`, 'utf8');
    it(`${name} is dispatch only, from main, in the sandbox environment`, () => {
      assert.match(text, /^on:\n {2}workflow_dispatch:/m);
      assert.doesNotMatch(text, /^ {2}(push|pull_request|schedule):/m);
      assert.match(text, /^ {4}environment: sandbox-nightly$/m);
      assert.match(text, /github\.ref == 'refs\/heads\/main'/);
    });
    it(`${name} uploads an artifact and prints a verdict line`, () => {
      assert.match(text, /actions\/upload-artifact@/);
      assert.match(text, /VERDICT/);
    });
    it(`${name} passes secrets only through env`, () => {
      for (const line of text.split('\n')) {
        if (/\$\{\{ secrets\./.test(line) && !/^\s*(#|if:)/.test(line)) {
          assert.match(line, /^\s+[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/, line);
        }
      }
    });
  }
});

describe('evidence-hosted workflow', () => {
  const text = readFileSync('.github/workflows/evidence-hosted.yml', 'utf8');
  it('is dispatch only and uses no secrets and no environment', () => {
    assert.match(text, /^on:\n {2}workflow_dispatch:/m);
    assert.doesNotMatch(text, /^ {2}(push|pull_request|schedule):/m);
    assert.doesNotMatch(text, /\$\{\{ secrets\./);
    assert.doesNotMatch(text, /^ {4}environment:/m);
  });
  it('only posts to the webhook route with an ignored event type', () => {
    const lib = readFileSync('scripts/evidence/hosted.mjs', 'utf8');
    assert.match(lib, /IGNORED_EVENT_TYPE = 'CHECKOUT\.ORDER\.APPROVED'/);
    assert.doesNotMatch(lib, /method: 'POST'[\s\S]*PAYMENT\.CAPTURE/);
  });
  it('bounds the sizes it is given', () => {
    assert.match(text, /check repeats "\$REPEATS" 1 5/);
    assert.match(text, /check webhook_n "\$WEBHOOK_N" 20 100/);
  });
});
