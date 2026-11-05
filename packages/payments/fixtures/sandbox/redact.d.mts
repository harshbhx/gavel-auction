export const G1_STEPS: readonly (readonly [string, string])[];
export function placeholderize(value: unknown): unknown;
export function tokenFindings(text: string): string[];
export function buildSandboxFixtures(evidenceText: string): Record<string, string>;
export function buildWebhookFixtures(srcDir: string): Record<string, string>;
