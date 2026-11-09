export function cspProblems(
  html: string,
  env?: Readonly<Record<string, string | undefined>>,
): string[];

export function staticImports(code: string): string[];
export function dynamicImports(code: string): string[];
export function entriesOf(html: string): string[];
export function initialGraph(dist: string, html: string): Map<string, string>;
export function gridChunks(dist: string): { name: string; bytes: number }[];
export const GRID_LIMIT_BYTES: number;
export function check(dist: string): {
  problems: string[];
  bytes: number;
  gridBytes: number;
  gridFiles: number;
};
