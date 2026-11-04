import { describe, expect, it } from 'vitest';

describe('@gavel/voice', () => {
  it('loads the public entry', async () => {
    const mod = await import('../src/index.js');
    expect(mod).toBeDefined();
  });
});
