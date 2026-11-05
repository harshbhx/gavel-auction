import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GatesResult } from '../src/gatesResult.js';

/**
 * Ties the flags in src/gates-result.json to docs/GATES.md and the evidence files (R-PAY-037).
 * A flag may leave its safe value only when the matching gate section is closed (Status PASS,
 * a recorded Decision, an Evidence line) and the evidence file exists with the recorded sha256.
 */

export function gateSection(md: string, gate: string): string | undefined {
  const re = new RegExp(`^## ${gate}:[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm');
  return re.exec(md)?.[1];
}

function field(section: string, name: string): string | undefined {
  return new RegExp(`^${name}:[ \\t]*(.+)$`, 'm').exec(section)?.[1]?.trim();
}

/** Returns the problems that keep a gate from backing a flag; an empty list means it does. */
export function gateEvidenceProblems(md: string, gate: string, root: string): string[] {
  const section = gateSection(md, gate);
  if (section === undefined) return [`${gate}: no section in GATES.md`];
  const out: string[] = [];
  if (field(section, 'Status') !== 'PASS') out.push(`${gate}: Status is not PASS`);
  const decision = field(section, 'Decision');
  if (decision === undefined || /^n\/a/i.test(decision)) out.push(`${gate}: no recorded Decision`);
  const ev = /^Evidence:[ \t]*(\S+)[ \t]+\(sha256 ([0-9a-f]{64})\)/m.exec(section);
  if (!ev) return [...out, `${gate}: no Evidence line with a sha256`];
  const file = join(root, ev[1] as string);
  if (!existsSync(file)) return [...out, `${gate}: evidence file ${ev[1]} is missing`];
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== ev[2]) out.push(`${gate}: evidence file hash differs from GATES.md`);
  return out;
}

/** Problems for every flag that is not in its safe state; the G1 mode must match the entry. */
export function gatesResultProblems(flags: GatesResult, md: string, root: string): string[] {
  const out: string[] = [];
  if (flags.g1_remainder_mode !== 'unknown') {
    out.push(...gateEvidenceProblems(md, 'G1', root));
    const verdict = /\(decision ([ABC])\)/.exec(gateSection(md, 'G1') ?? '')?.[1];
    if (verdict !== flags.g1_remainder_mode) {
      out.push(`G1: GATES.md decision ${verdict ?? 'none'} differs from the flag`);
    }
  }
  if (flags.g2_card_authorize) out.push(...gateEvidenceProblems(md, 'G2', root));
  if (flags.g4_webhooks_verified) out.push(...gateEvidenceProblems(md, 'G4', root));
  return out;
}
