// Guard for the manual real-server-kill workflow (issue 2185): dispatch only, from main, in the
// protected sandbox environment, secrets only through env, a verdict line and an artifact.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const text = readFileSync('.github/workflows/evidence-server-kill.yml', 'utf8');

describe('evidence-server-kill workflow', () => {
  it('is dispatch only, from main, in the sandbox environment', () => {
    assert.match(text, /^on:\n {2}workflow_dispatch:/m);
    assert.doesNotMatch(text, /^ {2}(push|pull_request|schedule):/m);
    assert.match(text, /^ {4}environment: sandbox-nightly$/m);
    assert.match(text, /github\.ref == 'refs\/heads\/main'/);
  });

  it('passes secrets only through env and prints a verdict line', () => {
    for (const line of text.split('\n')) {
      if (/\$\{\{ secrets\./.test(line) && !/^\s*(#|if:)/.test(line)) {
        assert.match(line, /^\s+[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/, line);
      }
    }
    assert.match(text, /SERVER KILL VERDICT/);
    assert.match(text, /actions\/upload-artifact@/);
  });

  it('arms the checkpoint the issue names and bounds the sandbox calls', () => {
    const harness = readFileSync('packages/e2e/src/sandbox/server-kill.ts', 'utf8');
    assert.match(harness, /CHECKPOINT = 'after_capture_request_before_response'/);
    assert.match(harness, /ACTORS = \['a', 'b', 'c'\]/);
  });

  it('keeps the buyer logins away from the server process', () => {
    const stack = readFileSync('packages/e2e/src/runner/stack.ts', 'utf8');
    assert.match(stack, /sandbox && \/\^SANDBOX_\/\.test\(k\)/);
  });
});
