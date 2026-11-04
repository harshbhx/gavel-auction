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
    env: {
      VITE_API_BASE: 'http://localhost:8787',
      VITE_WS_BASE: 'ws://localhost:8787',
      VITE_PAYPAL_CLIENT_ID: 'sandbox-client',
      VITE_SANDBOX: 'true',
      VITE_PAYMENTS: 'fake',
    },
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
