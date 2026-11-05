// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  bannedBeforeCapture,
  bannedEverywhere,
  superlativeFirst,
  wordingExemptions,
} from '../../src/copy/banned';
import { AFTER_CAPTURE_KEYS, en, type CopyKey } from '../../src/copy/en';

const SRC = new URL('../../src/', import.meta.url).pathname;

/** Files that predate the catalog rule. Remove each entry when the file moves to catalog keys. */
const LITERAL_ALLOWLIST: readonly string[] = ['App.tsx'];

function listSource(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSource(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, kind);
}

/** Literal user-facing strings in JSX text and in aria-label attributes. */
export function findJsxLiterals(file: string, text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && node.text.trim() !== '') found.push(node.text.trim());
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText() === 'aria-label' &&
      node.initializer !== undefined
    ) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) found.push(init.text);
      if (
        ts.isJsxExpression(init) &&
        init.expression !== undefined &&
        (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
      ) {
        found.push(init.expression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return found;
}

interface TCall {
  key: string;
  params: string[] | null;
}

/** Calls of the form t('key') or t('key', { a, b }). */
export function findTCalls(file: string, text: string): TCall[] {
  const calls: TCall[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't'
    ) {
      const [first, second] = node.arguments;
      if (first !== undefined && ts.isStringLiteralLike(first)) {
        let params: string[] | null = [];
        if (second !== undefined) {
          if (ts.isObjectLiteralExpression(second)) {
            params = second.properties.flatMap((p) =>
              ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
                ? [p.name.getText()]
                : [],
            );
          } else {
            params = null;
          }
        }
        calls.push({ key: first.text, params });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return calls;
}

export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? '');
}

export function findUnusedKeys(keys: readonly string[], usedText: string): string[] {
  return keys.filter((k) => !usedText.includes(`'${k}'`) && !usedText.includes(`"${k}"`));
}

const entries = Object.entries(en) as Array<[CopyKey, string]>;
const sourceFiles = listSource(SRC).filter((f) => !f.includes('/copy/'));

describe('JSX literal scan (R-WEB-002)', () => {
  it('detects JSX text and aria-label literals', () => {
    expect(findJsxLiterals('a.tsx', 'const a = <p>Hello <b>x</b></p>;')).toEqual(['Hello', 'x']);
    expect(findJsxLiterals('a.tsx', 'const a = <button aria-label="Close" />;')).toEqual(['Close']);
    expect(findJsxLiterals('a.tsx', "const a = <button aria-label={'Close'} />;")).toEqual([
      'Close',
    ]);
  });

  it('accepts catalog lookups', () => {
    expect(
      findJsxLiterals(
        'a.tsx',
        "const a = <button aria-label={t('generic.close')}>{t('generic.back')}</button>;",
      ),
    ).toEqual([]);
  });

  it('finds no literal strings in source JSX', () => {
    const offenders = sourceFiles
      .filter((f) => f.endsWith('.tsx') && !LITERAL_ALLOWLIST.includes(relative(SRC, f)))
      .flatMap((f) =>
        findJsxLiterals(f, readFileSync(f, 'utf8')).map((s) => `${relative(SRC, f)}: ${s}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe('banned wording (R-WEB-120, R-WEB-122)', () => {
  const exempt = new Set<string>([...AFTER_CAPTURE_KEYS, ...Object.keys(wordingExemptions)]);

  it('flags the words the spec bans', () => {
    const flagged = (s: string): boolean => bannedBeforeCapture.some((r) => r.test(s));
    for (const s of [
      'Charged $5',
      'Charging winning price',
      'Charge the winner',
      'The winner is charged the winning price',
      'Pay now',
      'Winner pays',
      'You have paid',
      'Capturing your payment',
      'Capture the hold',
      'Your payment',
      'debited',
      'billed',
      'deducted',
      'a fee',
    ]) {
      expect(flagged(s), s).toBe(true);
    }
    for (const s of [
      'Held, not charged.',
      'The winner is charged only if the hammer falls',
      'Finalising winning price',
      '{c} captured, {r} released',
      'You are charged only if you win',
      'not a payment',
      'Voice feed',
    ]) {
      expect(flagged(s), s).toBe(false);
    }
  });

  it('keeps banned wording out of every non-exempt key', () => {
    const hits = entries
      .filter(([k]) => !exempt.has(k))
      .flatMap(([k, v]) => bannedBeforeCapture.filter((r) => r.test(v)).map((r) => `${k}: ${r}`));
    expect(hits).toEqual([]);
  });

  it('bans fund claims and superlatives in every key', () => {
    const hits = entries
      .filter(([k]) => wordingExemptions[k] === undefined)
      .flatMap(([k, v]) =>
        [...bannedEverywhere, superlativeFirst].filter((r) => r.test(v)).map((r) => `${k}: ${r}`),
      );
    expect(hits).toEqual([]);
  });

  it('pins the exempt keys: each is shown only after money is charged (WEB-RT-11, WEB-RT-12)', () => {
    expect(Object.keys(wordingExemptions).sort()).toEqual([
      'bid.waitingLot',
      'ladder.fallback',
      'ladder.invariants.ok',
      'ladder.state.CAPTURED',
      'receipt.failed',
      'replay.chapter.bid',
    ]);
    expect(Object.values(wordingExemptions).every((reason) => (reason ?? '').length > 10)).toBe(
      true,
    );
  });

  it('does not over-promise releases or imply a charge in the stop and failed copy', () => {
    expect(en['kill.consequence']).not.toMatch(/\ball holds are released\b/i);
    expect(en['kill.consequence']).toMatch(/holds will be released/i);
    expect(en['receipt.failed']).not.toMatch(/nothing more will be charged/i);
    expect(en['receipt.failedNoCapture']).toMatch(/not charged/i);
    expect(
      bannedBeforeCapture.filter((r) => r.test(en['receipt.failedNoCapture'])),
      'receipt.failedNoCapture',
    ).toEqual([]);
  });

  it('keeps the pre-registration rule text and the capture step free of charge wording', () => {
    for (const key of [
      'landing.explain',
      'landing.promise',
      'ladder.state.CAPTURING',
      'receipt.capturing',
    ] as const) {
      expect(
        bannedBeforeCapture.filter((r) => r.test(en[key])),
        key,
      ).toEqual([]);
    }
    expect(en['landing.explain']).toContain('charged only if');
  });

  it('has no exemption for a key that does not need one', () => {
    const stale = Object.keys(wordingExemptions).filter((k) => {
      const v = en[k as CopyKey];
      return ![...bannedBeforeCapture, ...bannedEverywhere, superlativeFirst].some((r) =>
        r.test(v),
      );
    });
    expect(stale).toEqual([]);
  });

  it('follows the copy rules: no exclamation marks', () => {
    expect(entries.filter(([, v]) => v.includes('!')).map(([k]) => k)).toEqual([]);
  });

  it('contains the required phrase', () => {
    expect(en['reg.heldNotCharged']).toContain('Held, not charged');
    expect(en['landing.promise']).toContain('Held, not charged');
  });
});

describe('catalog integrity', () => {
  it('uses well-formed placeholders in every key', () => {
    const bad = entries.filter(([, v]) => {
      const names = placeholders(v);
      const stripped = v.replace(/\{[A-Za-z0-9_]+\}/g, '');
      return names.some((n) => !/^[A-Za-z0-9_]+$/.test(n)) || /[{}]/.test(stripped);
    });
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('references only existing keys and supplies every placeholder', () => {
    const problems: string[] = [];
    for (const f of sourceFiles) {
      for (const call of findTCalls(f, readFileSync(f, 'utf8'))) {
        const where = `${relative(SRC, f)}: ${call.key}`;
        if (!(call.key in en)) {
          problems.push(`${where} is not in the catalog`);
          continue;
        }
        const needed = placeholders(en[call.key as CopyKey]);
        const given = call.params;
        if (given === null) continue;
        for (const n of needed) if (!given.includes(n)) problems.push(`${where} misses {${n}}`);
        for (const g of given)
          if (!needed.includes(g)) problems.push(`${where} passes unknown ${g}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('reports unused keys', () => {
    expect(findUnusedKeys(['a.b', 'c.d'], "t('a.b')")).toEqual(['c.d']);
  });
});
