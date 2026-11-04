import { centsToDecimal } from '../src/money.js';
import type { BuyerCredentials } from './buyerApproval.js';

/** Small JSON readers and request helpers shared by the gate scripts. */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function field(json: unknown, key: string): unknown {
  return isRecord(json) ? json[key] : undefined;
}

/** Currency of the gate orders: GATE_CURRENCY, INR by default (the sandbox accounts are Indian). */
export const DEFAULT_GATE_CURRENCY = 'INR';

export function gateCurrency(env: Record<string, string | undefined> = process.env): string {
  const raw = env['GATE_CURRENCY']?.trim().toUpperCase();
  return raw === undefined || raw === '' ? DEFAULT_GATE_CURRENCY : raw;
}

export function amount(
  cents: number,
  currency: string = gateCurrency(),
): { currency_code: string; value: string } {
  return { currency_code: currency, value: centsToDecimal(cents) };
}

/** The buyer approval link of an order response, or "". */
export function approveLink(json: unknown): string {
  const links = field(json, 'links');
  if (!Array.isArray(links)) return '';
  for (const l of links) {
    if (isRecord(l) && (l['rel'] === 'payer-action' || l['rel'] === 'approve')) {
      return str(l['href']);
    }
  }
  return '';
}

/** First authorization of the first purchase unit of an authorize or order response. */
export function firstAuthorization(json: unknown): Record<string, unknown> {
  const units = field(json, 'purchase_units');
  const unit = Array.isArray(units) && isRecord(units[0]) ? units[0] : {};
  const payments = isRecord(unit['payments']) ? unit['payments'] : {};
  const list = Array.isArray(payments['authorizations']) ? payments['authorizations'] : [];
  return isRecord(list[0]) ? list[0] : {};
}

/** "NAME ISSUE" of a PayPal error body, or "". */
export function errorName(json: unknown): string {
  const details = field(json, 'details');
  const issue = Array.isArray(details) && isRecord(details[0]) ? str(details[0]['issue']) : '';
  return [str(field(json, 'name')), issue].filter((x) => x !== '').join(' ');
}

export function payerEmail(json: unknown): string | undefined {
  const payer = field(json, 'payer');
  const email = isRecord(payer) ? payer['email_address'] : undefined;
  return typeof email === 'string' ? email : undefined;
}

/** Credentials from SANDBOX_BUYER_* (wallet) or SANDBOX_CARD_BUYER_* (card), when both are set. */
export function buyerCredentials(
  env: Record<string, string | undefined>,
  kind: 'wallet' | 'card',
): BuyerCredentials | undefined {
  const prefix = kind === 'wallet' ? 'SANDBOX_BUYER' : 'SANDBOX_CARD_BUYER';
  const email = env[`${prefix}_EMAIL`] ?? '';
  const password = env[`${prefix}_PASSWORD`] ?? '';
  return email.trim() !== '' && password !== '' ? { email, password } : undefined;
}
