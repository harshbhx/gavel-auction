// Builds the committed sandbox fixtures from evidence files of gates G1 and G4.
// Usage: node redact.mjs <G1 evidence .jsonl> <webhook fixture dir> [--check]
// Evidence is already redacted by the gate scripts; this step replaces the ids with the
// placeholders {{ORDER_ID}}, {{AUTH_ID}}, {{CAPTURE_ID}}, {{EVENT_ID}} and {{DEBUG_ID}} and then
// refuses to write a file that still looks like it holds a token. See README.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Response steps of the G1 evidence that become fixtures: step prefix, file name. */
export const G1_STEPS = [
  ['G1.1 create order', 'order-created'],
  ['G1.2 order after approval', 'order-approved'],
  ['G1.3 authorize', 'order-authorized'],
  ['G1.4 read authorization', 'authorization-created'],
  ['G1.5 capture 350 final', 'capture-final'],
  ['G1.6 read authorization after capture', 'authorization-after-capture'],
  ['G1.6 read order after capture', 'order-after-capture'],
  ['G1.7 void attempt', 'void-rejected'],
  ['G1.8 read after void attempt', 'authorization-after-void-attempt'],
];

const ID = '[A-Z0-9]{10,24}';

/** Replaces PayPal ids with placeholders. The ids are found in links and well known fields. */
export function placeholderize(value) {
  let text = JSON.stringify(value);
  const found = new Map();
  const grab = (re, placeholder) => {
    for (const m of text.matchAll(re)) found.set(m[1], placeholder);
  };
  grab(new RegExp(`/v2/payments/authorizations/(${ID})`, 'g'), '{{AUTH_ID}}');
  grab(new RegExp(`/v2/payments/captures/(${ID})`, 'g'), '{{CAPTURE_ID}}');
  grab(new RegExp(`/v2/checkout/orders/(${ID})`, 'g'), '{{ORDER_ID}}');
  grab(new RegExp(`"(?:authorization_id)":"(${ID})"`, 'g'), '{{AUTH_ID}}');
  grab(new RegExp(`"(?:capture_id)":"(${ID})"`, 'g'), '{{CAPTURE_ID}}');
  grab(new RegExp(`"(?:order_id)":"(${ID})"`, 'g'), '{{ORDER_ID}}');
  for (const [id, placeholder] of found) text = text.split(id).join(placeholder);
  text = text.replace(/WH-[A-Z0-9-]+/g, '{{EVENT_ID}}');
  text = text.replace(/"debug_id":"[^"]*"/g, '"debug_id":"{{DEBUG_ID}}"');
  return JSON.parse(text);
}

const TOKEN_LIKE = [
  /Bearer\s+\S+/i,
  /Basic\s+[A-Za-z0-9+/=]{12,}/,
  /access_token"\s*:\s*"(?!\[REDACTED\])/,
  /client_secret"\s*:\s*"(?!\[REDACTED\])/,
  /A[A-Za-z0-9_-]{20}\.[A-Za-z0-9_-]{20,}/,
  /token=(?!\[REDACTED\])[^"&\s]+/,
  /@[a-z0-9-]+\.[a-z]{2,}/i,
];

/** Names of the token patterns that match the text; empty when it is clean. */
export function tokenFindings(text) {
  return TOKEN_LIKE.filter((re) => re.test(text)).map((re) => re.source);
}

function stable(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildSandboxFixtures(evidenceText) {
  const records = evidenceText
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
  const out = {};
  for (const [step, name] of G1_STEPS) {
    // The G1.6 authorization read appears twice; the first one is the fixture.
    const rec = records.find((r) => r.step === step && r.response);
    if (!rec) continue;
    const { status, body } = rec.response;
    out[`${name}.json`] = stable(placeholderize({ status, body }));
  }
  return out;
}

export function buildWebhookFixtures(srcDir) {
  const out = {};
  for (const f of readdirSync(srcDir).filter((n) => n.endsWith('.json'))) {
    const body = JSON.parse(readFileSync(join(srcDir, f), 'utf8'));
    const resource = body.resource ?? {};
    const own = typeof resource.id === 'string' ? resource.id : undefined;
    let text = JSON.stringify(body);
    const type = String(body.event_type ?? '');
    const placeholder = type.includes('CAPTURE')
      ? '{{CAPTURE_ID}}'
      : type.includes('AUTHORIZATION')
        ? '{{AUTH_ID}}'
        : '{{ORDER_ID}}';
    if (own) text = text.split(own).join(placeholder);
    out[f] = stable(placeholderize(JSON.parse(text)));
  }
  return out;
}

function writeAll(dir, files, check) {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const bad = tokenFindings(text);
    if (bad.length > 0) throw new Error(`${name} still matches a token pattern: ${bad.join(' ')}`);
    const path = join(dir, name);
    if (check) {
      // Compared as data: prettier may lay the committed files out differently.
      if (
        !existsSync(path) ||
        JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(JSON.parse(text))
      ) {
        throw new Error(`${path} is out of date`);
      }
    } else {
      writeFileSync(path, text);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [evidence, webhookSrc] = process.argv.slice(2);
  const check = process.argv.includes('--check');
  if (!evidence || !webhookSrc) {
    console.error('usage: node redact.mjs <G1 evidence .jsonl> <webhook fixture dir> [--check]');
    process.exit(2);
  }
  writeAll(here, buildSandboxFixtures(readFileSync(evidence, 'utf8')), check);
  writeAll(
    join(here, '..', '..', '..', 'e2e', 'fixtures', 'webhooks'),
    buildWebhookFixtures(webhookSrc),
    check,
  );
}
