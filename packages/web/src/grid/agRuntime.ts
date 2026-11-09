import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

/**
 * The one place AG Grid is registered. Every grid under src/grid imports this file, and every grid is
 * reached through React.lazy (see index.tsx), so AG Grid lives in its own chunk (named ag-grid by the
 * Vite config) and the landing and bidder bundles do not grow. Community edition only: MIT, no licence
 * key, no watermark. Nothing from ag-grid-enterprise is used.
 */
ModuleRegistry.registerModules([AllCommunityModule]);

export { AgGridReact } from 'ag-grid-react';
