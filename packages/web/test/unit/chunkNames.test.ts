// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chunkFileName } from '../../vite.config';

describe('chunkFileName', () => {
  it('names the chunk that holds AG Grid (community or react) ag-grid', () => {
    expect(
      chunkFileName({
        moduleIds: [
          '/repo/packages/web/src/grid/agRuntime.ts',
          '/repo/node_modules/ag-grid-community/dist/package/main.esm.mjs',
        ],
      }),
    ).toBe('assets/ag-grid-[hash].js');
    expect(
      chunkFileName({ moduleIds: ['C:\\repo\\node_modules\\ag-grid-react\\dist\\index.js'] }),
    ).toBe('assets/ag-grid-[hash].js');
  });

  it('leaves every other chunk with its default name', () => {
    expect(
      chunkFileName({
        moduleIds: [
          '/repo/packages/web/src/grid/LedgerGrid.tsx',
          '/repo/node_modules/react/index.js',
        ],
      }),
    ).toBe('assets/[name]-[hash].js');
  });
});
