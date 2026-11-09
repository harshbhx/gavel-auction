import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  CsvExportModule,
  DragAndDropModule,
  GridStateModule,
  HighlightChangesModule,
  ModuleRegistry,
  NumberFilterModule,
  PinnedRowModule,
  QuickFilterModule,
  RowApiModule,
  RowSelectionModule,
  RowStyleModule,
  TextFilterModule,
  TooltipModule,
  ValidationModule,
} from 'ag-grid-community';

/**
 * The one place AG Grid is registered. Every grid under src/grid imports this file, and every grid is
 * reached through React.lazy (see index.tsx), so AG Grid lives in its own chunk (named ag-grid by the
 * Vite config) and the landing and bidder bundles do not grow. Community edition only: MIT, no licence
 * key, no watermark. Nothing from ag-grid-enterprise is used.
 *
 * Only the modules the grids use are registered, not AllCommunityModule: sorting and the row model,
 * text and number filters, the quick filter, row selection, CSV export, row transactions, the pinned
 * totals row, cell and row classes, tooltips, change flashes, column state and column drag. A grid
 * feature that needs another module logs an AG Grid error (#200) in development; add the module here.
 */
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  RowApiModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  DragAndDropModule,
  TextFilterModule,
  NumberFilterModule,
  QuickFilterModule,
  RowSelectionModule,
  CsvExportModule,
  PinnedRowModule,
  CellStyleModule,
  RowStyleModule,
  TooltipModule,
  HighlightChangesModule,
  GridStateModule,
  // Messages for a missing module or a bad option; development and tests only, not shipped.
  ...(import.meta.env.DEV ? [ValidationModule] : []),
]);

export { AgGridReact } from 'ag-grid-react';
