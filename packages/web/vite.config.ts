import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Fails a production build unless VITE_SANDBOX is exactly "true". */
export function sandboxGuard(): Plugin {
  return {
    name: 'gavel-sandbox-guard',
    apply: 'build',
    configResolved(resolved) {
      const env = loadEnv(resolved.mode, resolved.envDir, 'VITE_');
      if (env['VITE_SANDBOX'] !== 'true') {
        throw new Error('Build refused: VITE_SANDBOX must be "true". This app is sandbox only.');
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), sandboxGuard()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
