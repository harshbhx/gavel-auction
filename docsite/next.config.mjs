import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// This folder has its own dependencies and lock file. The repository root has another lock
// file (the npm workspaces), so the project root is pinned here instead of being inferred.
const root = fileURLToPath(new URL('.', import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  // Static export has no image server; serve images as-is.
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default withMDX(config);
