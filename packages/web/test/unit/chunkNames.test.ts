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

  it('keeps React in its own chunk, so AG Grid does not pull it in and land in the entry', () => {
    expect(manualChunks('/repo/node_modules/react/index.js')).toBe('react');
    expect(manualChunks('/repo/node_modules/react-dom/client.js')).toBe('react');
    expect(manualChunks('/repo/node_modules/scheduler/index.js')).toBe('react');
  });

  it('leaves app code and other libraries to Rollup', () => {
    expect(manualChunks('/repo/packages/web/src/grid/LedgerGrid.tsx')).toBeUndefined();
    expect(manualChunks('/repo/node_modules/zustand/index.js')).toBeUndefined();
  });
});
