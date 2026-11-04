// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

describe('sandbox build guard', () => {
  it('rejects a build when VITE_SANDBOX is not true', async () => {
    const { sandboxGuard } = await import('../../vite.config');
    const plugin = sandboxGuard();
    const hook = plugin.configResolved as (c: { mode: string; envDir: string }) => void;
    vi.stubEnv('VITE_SANDBOX', 'false');
    expect(() => hook({ mode: 'test', envDir: '/nonexistent' })).toThrow(/VITE_SANDBOX/);
    vi.stubEnv('VITE_SANDBOX', 'true');
    expect(() => hook({ mode: 'test', envDir: '/nonexistent' })).not.toThrow();
    vi.unstubAllEnvs();
  });
});
