// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { manualChunks } from '../../vite.config';

describe('manualChunks', () => {
  it('puts AG Grid (community and react) in the ag-grid chunk', () => {
    expect(manualChunks('/repo/node_modules/ag-grid-community/dist/package/main.esm.mjs')).toBe(
      'ag-grid',
    );
    expect(manualChunks('C:\\repo\\node_modules\\ag-grid-react\\dist\\index.js')).toBe('ag-grid');
  });

  it('leaves app code and other libraries to Rollup', () => {
    expect(manualChunks('/repo/packages/web/src/grid/LedgerGrid.tsx')).toBeUndefined();
    expect(manualChunks('/repo/node_modules/react/index.js')).toBeUndefined();
  });
});
