import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkHeldout, heldoutHash } from '../scripts/check-heldout.js';

function text(name: string): string {
  return readFileSync(new URL(`../fixtures/text/${name}`, import.meta.url), 'utf8');
}

const cases: unknown = JSON.parse(text('cases.json'));
const recorded = text('HELDOUT.sha256');
const changelog = text('CHANGELOG-HELDOUT.md');

describe('T-VOX-055 held-out hash guard (R-VOX-077)', () => {
  it('the committed held-out set matches the recorded hash and changelog', () => {
    expect(heldoutHash(cases)).toBe(recorded.trim());
    expect(checkHeldout({ cases, recorded, changelog })).toEqual([]);
  });

  it('changing one byte of a held-out case fails the check', () => {
    const edited = (cases as Array<Record<string, unknown>>).map((c) =>
      c['id'] === 'plain-016' ? { ...c, text: String(c['text']) + '.' } : c,
    );
    const errors = checkHeldout({ cases: edited, recorded, changelog });
    expect(errors.join('\n')).toMatch(/held-out set changed/);
  });

  it('changing a dev case does not affect the hash', () => {
    const edited = (cases as Array<Record<string, unknown>>).map((c) =>
      c['id'] === 'plain-001' ? { ...c, text: 'three hundred' } : c,
    );
    expect(heldoutHash(edited)).toBe(heldoutHash(cases));
  });

  it('a new hash without a changelog line still fails', () => {
    const edited = (cases as Array<Record<string, unknown>>).filter((c) => c['id'] !== 'plain-016');
    const newHash = heldoutHash(edited);
    const errors = checkHeldout({ cases: edited, recorded: newHash, changelog });
    expect(errors.join('\n')).toMatch(/does not name the hash/);
  });

  it('a new hash with a new dated line passes', () => {
    const edited = (cases as Array<Record<string, unknown>>).filter((c) => c['id'] !== 'plain-016');
    const newHash = heldoutHash(edited);
    const log = `${changelog}\n- 2026-11-05 ${newHash} dropped one case after review\n`;
    expect(checkHeldout({ cases: edited, recorded: newHash, changelog: log })).toEqual([]);
  });

  it('entries out of date order fail, and an empty changelog fails', () => {
    const log = `${changelog}\n- 2026-01-01 ${recorded.trim()} backdated\n`;
    expect(checkHeldout({ cases, recorded, changelog: log }).join()).toMatch(/date order/);
    expect(checkHeldout({ cases, recorded, changelog: '' }).join()).toMatch(/no dated entry/);
  });
});
