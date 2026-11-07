import { llms, loader } from 'fumadocs-core/source';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { lucideIconsPlugin } from 'fumadocs-core/source/plugins/lucide-icons';
import { statusBadgesPlugin } from 'fumadocs-core/source/plugins/status-badges';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { z } from 'zod';
import { createElement } from 'react';
import { StatusBadge } from './status-badge';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // `status: verified | code-checked | simulated | in progress | unverified | fail | planned` adds a
    // sidebar badge. `verified` needs a real run or committed evidence; `code-checked` means the page was
    // read against the code it describes (nothing was run); `evidence` says which.
    schema: pageSchema.extend({
      status: z.string().optional(),
      // One line saying what the status rests on (the files read, the run, the gate).
      evidence: z.string().optional(),
    }),
    // ```mermaid code blocks render as diagrams (see components/mermaid.tsx).
    mdxOptions: applyMdxPreset({ remarkPlugins: [remarkMdxMermaid] }),
    // Last commit date of each page, read from git (shown at the bottom of the page).
    lastModified: true,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [
    lucideIconsPlugin(),
    statusBadgesPlugin({ renderBadge: (status) => createElement(StatusBadge, { status }) }),
  ],
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
});
