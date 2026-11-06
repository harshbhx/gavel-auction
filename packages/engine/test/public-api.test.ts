import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import { exportJsonl, headOf, sealBatch, tamperAt, verifyJsonl } from '../src/index.js';
import { verifyLedgerFile } from '../src/node/index.js';

const pkgDir = new URL('..', import.meta.url).pathname;
const AUCTION = '01JC0000000000000000000001' as api.Ulid;

function ledger(): ReturnType<typeof sealBatch> {
  const head = { auctionId: AUCTION, seq: 0, hash: api.GENESIS_PREV };
  const first = sealBatch(
    [{ type: 'AUCTION_CREATED', payload: { title: 'Spring Gala' } } as never],
    head,
    1788000000000,
    null,
  );
  const last = first[first.length - 1] as { seq: number; hash: string };
  const rest = sealBatch(
    [
      { type: 'LOT_ADDED', payload: { lotId: 'L1' } } as never,
      { type: 'LOT_ADDED', payload: { lotId: 'L2' } } as never,
    ],
    { auctionId: AUCTION, seq: last.seq, hash: last.hash },
    1788000001000,
    null,
  );
  return [...first, ...rest];
}

function node(script: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [join(pkgDir, script), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? '' };
  }
}

describe('ledger export', () => {
  it('T-ENG-058 R-ENG-078 exports one canonical JSON line per entry and verifies it', () => {
    const entries = ledger();
    const text = exportJsonl(entries);
    expect(text.split('\n')).toHaveLength(entries.length + 1);
    const r = verifyJsonl(text);
    expect(r).toEqual({ ok: true, count: 3, headHash: headOf(entries)?.hash, closed: false });
    expect(verifyJsonl(text + '\n\n')).toEqual(r);
    expect(verifyJsonl('')).toMatchObject({ ok: true, count: 0 });
  });

  it('T-ENG-058 R-ENG-078 verifyJsonl names a tampered line and a malformed line', () => {
    const text = exportJsonl(ledger());
    expect(verifyJsonl(tamperAt(text, 1))).toEqual({
      ok: false,
      firstBadIndex: 1,
      reason: 'bad_hash',
    });
    const lines = text.split('\n');
    lines[2] = '{not json';
    expect(verifyJsonl(lines.join('\n'))).toMatchObject({ ok: false, firstBadIndex: 2 });
    const blank = text.split('\n');
    blank[1] = '';
    expect(verifyJsonl(blank.join('\n'))).toMatchObject({ ok: false, firstBadIndex: 1 });
    expect(() => tamperAt(text, 9)).toThrow(RangeError);
  });

  it('T-ENG-058 R-ENG-078 the verify-ledger CLI prints the head hash and the first bad index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-ledger-'));
    try {
      const entries = ledger();
      const good = join(dir, 'good.jsonl');
      const bad = join(dir, 'bad.jsonl');
      writeFileSync(good, exportJsonl(entries));
      writeFileSync(bad, tamperAt(exportJsonl(entries), 2));
      const open = node('bin/verify-ledger.mjs', [good]);
      expect(open.code).toBe(1);
      expect(open.out).toContain('not closed');
      const ok = node('bin/verify-ledger.mjs', ['--allow-open', good]);
      expect(ok.code).toBe(0);
      expect(ok.out).toContain(headOf(entries)?.hash);
      expect(verifyLedgerFile(good)).toMatchObject({ ok: true, count: 3 });
      const fail = node('bin/verify-ledger.mjs', [bad]);
      expect(fail.code).toBe(1);
      expect(fail.out).toContain('first bad index 2');
      expect(node('bin/verify-ledger.mjs', []).code).toBe(2);
      const head = headOf(entries);
      const goodHead = `${head?.seq}:${head?.hash}`;
      expect(node('bin/verify-ledger.mjs', ['--allow-open', '--head', goodHead, good]).code).toBe(
        0,
      );
      const cut = join(dir, 'cut.jsonl');
      writeFileSync(cut, exportJsonl(entries.slice(0, 2)));
      const trunc = node('bin/verify-ledger.mjs', ['--head', goodHead, cut]);
      expect(trunc.code).toBe(1);
      expect(trunc.out).toContain('truncated');
      const empty = join(dir, 'empty.jsonl');
      writeFileSync(empty, '');
      expect(node('bin/verify-ledger.mjs', [empty]).code).toBe(1);
      expect(node('bin/verify-ledger.mjs', ['--allow-empty', '--allow-open', empty]).code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('package surface', () => {
  it('T-ENG-085 R-ENG-125 the exported names match api.snapshot.txt', () => {
    const src = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8');
    const names: string[] = [];
    for (const m of src.matchAll(/export (type )?\{([^}]*)\}/g)) {
      for (const raw of (m[2] ?? '').split(',')) {
        const n = raw.trim();
        if (n !== '') names.push((m[1] ? 'type ' : '') + n);
      }
    }
    const sorted = [...new Set(names)].sort((a, b) => {
      const ta = a.startsWith('type ') ? 1 : 0;
      const tb = b.startsWith('type ') ? 1 : 0;
      const x = a.replace('type ', '');
      const y = b.replace('type ', '');
      return ta - tb || (x < y ? -1 : x > y ? 1 : 0);
    });
    const snapshot = readFileSync(join(pkgDir, 'api.snapshot.txt'), 'utf8')
      .split('\n')
      .filter((l) => l !== '');
    expect(sorted).toEqual(snapshot);
    const values = snapshot.filter((n) => !n.startsWith('type ')).sort();
    expect(Object.keys(api).sort()).toEqual(values);
  });

  it('T-ENG-085 R-ENG-120 the core entry point bundles for the browser with no node imports', () => {
    const r = node('scripts/bundle-check.mjs', []);
    expect(r.code).toBe(0);
    expect(r.out).toContain('browser bundle ok');
  });

  it('T-ENG-085 R-ENG-120 the bundle check rejects a node import', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-bundle-'));
    try {
      writeFileSync(join(dir, 'e.ts'), "import { sep } from 'node:path';\nexport const x = sep;\n");
      const r = node('scripts/bundle-check.mjs', ['--entry', join(dir, 'e.ts')]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('node:path');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
