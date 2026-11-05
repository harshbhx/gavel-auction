// Production build: bundles the server entry and the @gavel/* workspace packages (which export
// TypeScript source) into one ESM file, packages/server/dist/main.js. No dev tooling is needed
// at runtime; `node dist/main.js` is the whole host.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  // Bundled CommonJS dependencies may call require(); give them one in the ESM output.
  banner: {
    js: "import { createRequire as __gavelCreateRequire } from 'node:module'; const require = __gavelCreateRequire(import.meta.url);",
  },
});
