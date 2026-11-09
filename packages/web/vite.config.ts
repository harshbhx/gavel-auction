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
      if (env['VITE_PAYMENTS'] === 'fake' && env['VITE_ALLOW_FAKE'] !== 'true') {
        throw new Error(
          'Build refused: VITE_PAYMENTS=fake needs VITE_ALLOW_FAKE=true. Fake payments are for demos only.',
        );
      }
    },
  };
}

const PAYPAL_ORIGINS = ['https://www.sandbox.paypal.com', 'https://api-m.sandbox.paypal.com'];
const DEV_ORIGINS = ['http://localhost:8787', 'ws://localhost:8787'];

/** Placeholder in index.html that the CSP plugin replaces with the generated policy. */
export const CSP_TOKEN = '__GAVEL_CSP__';

type EnvMap = Readonly<Record<string, string | undefined>>;

/** The origin of an absolute URL, or null when it is not one (or is a wildcard-like value). */
function originOf(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** Origins connect-src allows: self, the configured API and WS origins, PayPal, localhost in dev. */
export function connectSources(env: EnvMap, dev: boolean): string[] {
  const configured = [originOf(env['VITE_API_BASE']), originOf(env['VITE_WS_BASE'])];
  const all = ["'self'", ...configured, ...PAYPAL_ORIGINS, ...(dev ? DEV_ORIGINS : [])];
  return [...new Set(all.filter((entry): entry is string => entry !== null))];
}

/** The full Content-Security-Policy for a build, generated from the same VITE_* config the app reads. */
export function buildCsp(env: EnvMap, dev: boolean): string {
  return [
    "default-src 'self'",
    // blob: is for the microphone worklet, which is loaded from a blob URL (audio/worklet.ts).
    "script-src 'self' blob: https://www.sandbox.paypal.com",
    `connect-src ${connectSources(env, dev).join(' ')}`,
    'frame-src https://www.sandbox.paypal.com',
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** Fills the CSP placeholder of an HTML page. */
export function renderCsp(html: string, env: EnvMap, dev: boolean): string {
  return html.replace(CSP_TOKEN, buildCsp(env, dev));
}

/** Writes the CSP meta content at build and dev time so the API and WS origins come from config. */
export function cspPlugin(): Plugin {
  let env: EnvMap = {};
  let dev = false;
  return {
    name: 'gavel-csp',
    configResolved(resolved) {
      env = loadEnv(resolved.mode, resolved.envDir, 'VITE_');
      dev = resolved.command === 'serve';
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => renderCsp(html, env, dev),
    },
  };
}

/** Fonts the first paint needs: body text (Public Sans) and the display headline (Big Shoulders). */
const PRELOAD_FONTS = /(?:public-sans|big-shoulders-display)-latin-wght-normal[^/]*\.woff2$/;

/** Preload tags for the built font files that match, with the site base prepended. */
export function fontPreloadTags(fileNames: readonly string[], base: string): string[] {
  return fileNames
    .filter((name) => PRELOAD_FONTS.test(name))
    .sort()
    .map(
      (name) =>
        `<link rel="preload" as="font" type="font/woff2" crossorigin href="${base}${name}" />`,
    );
}

/**
 * Adds a preload link for the two above-the-fold fonts to the built index.html, so the browser
 * fetches them with the stylesheet instead of after it (HTML -> CSS -> font becomes HTML -> font).
 * The hashed file names are only known after bundling, so this runs on the build output.
 */
export function fontPreloadPlugin(): Plugin {
  let base = '/';
  return {
    name: 'gavel-font-preload',
    apply: 'build',
    configResolved(resolved) {
      base = resolved.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) => {
        const tags = fontPreloadTags(Object.keys(ctx.bundle ?? {}), base);
        if (tags.length === 0) return html;
        return html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`);
      },
    },
  };
}

const AG_GRID_MODULE = /[\\/]node_modules[\\/](?:ag-grid-community|ag-grid-react)[\\/]/;

/**
 * Names the AG Grid chunk. Rollup names a shared chunk after whichever module it saw first (it was
 * useGridEnv-*.js), so the chunk that holds the library is named here instead: assets/ag-grid-*.js.
 * scripts/check-size.mjs finds the chunk by that prefix: it keeps it out of the initial route and
 * holds it to its own size budget. This renames only; chunk contents stay as Rollup split them (a
 * manualChunks rule would pull React into the chunk and the entry would then import AG Grid).
 */
export function chunkFileName(chunk: { moduleIds: readonly string[] }): string {
  return chunk.moduleIds.some((id) => AG_GRID_MODULE.test(id))
    ? 'assets/ag-grid-[hash].js'
    : 'assets/[name]-[hash].js';
}

export default defineConfig({
  plugins: [react(), sandboxGuard(), cspPlugin(), fontPreloadPlugin()],
  build: { rollupOptions: { output: { chunkFileNames: chunkFileName } } },
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
