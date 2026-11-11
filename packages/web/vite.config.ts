import react from '@vitejs/plugin-react';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

export const SITE_ORIGIN = 'https://gavel.dualmindlab.tech';

export interface RoutePreview {
  /** Route path as the router matches it. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** File name under public/og/. */
  readonly image: string;
  readonly alt: string;
}

const ALT_LANDING =
  'GAVEL: Every bid is a hold. The hammer is the payment. PayPal sandbox only. Partners: Render, APIMatic, AG Grid.';
const ALT_TRY =
  'GAVEL judge panel: Try it in 2 minutes. No login. Every bid is a hold. The hammer is the payment. PayPal sandbox only.';
const ALT_LEDGER =
  'GAVEL ledger: check the receipts yourself. A hash-chained ledger you can verify. PayPal sandbox only.';

/**
 * Pages whose link preview differs from the landing page. Social crawlers do not run JavaScript, so
 * each page is written as its own static index.html at build time (closeBundle below); the single
 * page app still boots from it. The landing page itself is index.html, written by hand.
 */
export const ROUTE_PREVIEWS: readonly RoutePreview[] = [
  {
    path: '/about',
    title: 'About GAVEL: every bid is a PayPal hold',
    description:
      'How GAVEL settles a live auction: every bid is a PayPal AUTHORIZE hold and only the winning price is captured. PayPal sandbox only.',
    image: 'og-landing.png',
    alt: ALT_LANDING,
  },
  {
    path: '/demo/scripted',
    title: 'GAVEL scripted demo: a live auction in two minutes',
    description:
      'Watch a scripted GAVEL auction: holds, bids, the hammer and the receipt. PayPal sandbox only, no real money moves.',
    image: 'og-landing.png',
    alt: ALT_LANDING,
  },
  {
    path: '/try',
    title: 'GAVEL judge panel: try it in 2 minutes, no login',
    description:
      'Start a sandbox auction, place a bid and watch the hold turn into the payment. No login. PayPal sandbox only.',
    image: 'og-try.png',
    alt: ALT_TRY,
  },
  {
    path: '/ledger',
    title: 'GAVEL ledger lab: check the receipts yourself',
    description:
      'A hash-chained ledger of every hold, bid and capture. Paste it in and verify the chain. PayPal sandbox only.',
    image: 'og-ledger.png',
    alt: ALT_LEDGER,
  },
  {
    path: '/verify',
    title: 'Verify a GAVEL ledger',
    description:
      'Paste a GAVEL ledger and verify its hash chain in your browser. PayPal sandbox only.',
    image: 'og-ledger.png',
    alt: ALT_LEDGER,
  },
];

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function setMeta(html: string, key: string, value: string): string {
  const re = new RegExp(`(<meta\\s+(?:name|property)="${key}"\\s+content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`index.html has no meta tag ${key}`);
  return html.replace(re, `$1${escapeAttr(value)}$2`);
}

/** index.html with the title, description, canonical, Open Graph and Twitter tags of one route. */
export function renderRoutePreview(html: string, preview: RoutePreview): string {
  const url = `${SITE_ORIGIN}${preview.path}`;
  const image = `${SITE_ORIGIN}/og/${preview.image}`;
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(preview.title)}</title>`);
  out = out.replace(
    /(<link rel="canonical" href=")[^"]*(")/,
    `$1${url}$2`,
  );
  for (const [key, value] of [
    ['description', preview.description],
    ['og:title', preview.title],
    ['og:description', preview.description],
    ['og:url', url],
    ['og:image', image],
    ['og:image:alt', preview.alt],
    ['twitter:title', preview.title],
    ['twitter:description', preview.description],
    ['twitter:image', image],
    ['twitter:image:alt', preview.alt],
  ] as const) {
    out = setMeta(out, key, value);
  }
  return out;
}

/** Writes dist/<route>/index.html for every ROUTE_PREVIEWS entry, from the built index.html. */
export function routePreviewPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'gavel-route-previews',
    apply: 'build',
    configResolved(resolved) {
      outDir = path.resolve(resolved.root, resolved.build.outDir);
    },
    closeBundle() {
      const index = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      for (const preview of ROUTE_PREVIEWS) {
        const dir = path.join(outDir, preview.path);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'index.html'), renderRoutePreview(index, preview));
      }
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
  plugins: [react(), sandboxGuard(), cspPlugin(), fontPreloadPlugin(), routePreviewPlugin()],
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
    // Browser history (the Home screen) lives in localStorage: no test may leak it into the next.
    setupFiles: ['test/support/clearHistory.ts'],
  },
});
