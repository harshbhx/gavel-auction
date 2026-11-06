import type { Cents } from '../types.js';

export const MAX_PROMPT_CHARS = 90;
export const MAX_HEARD_CHARS = 30;
export const DROP_CAPTION = 'Did not catch that.';

export type PromptData =
  | { kind: 'single'; amountCents: Cents; paddle: string }
  | { kind: 'device_mic'; amountCents: Cents }
  | { kind: 'two_amounts'; amountACents: Cents; amountBCents: Cents; paddle: string }
  | {
      kind: 'two_bidders';
      paddleA: string;
      amountACents: Cents;
      paddleB: string;
      amountBCents: Cents;
    }
  | { kind: 'unknown_bidder'; amountCents: Cents }
  | { kind: 'unregistered'; paddle: string; amountCents: Cents }
  | { kind: 'homophone'; text: string; amountACents: Cents; amountBCents: Cents }
  | { kind: 'correction'; paddle: string; amountCents: Cents; fromCents?: Cents }
  | { kind: 'currency'; amountCents: Cents }
  | { kind: 'currency_unparsed' }
  | { kind: 'large_jump'; times: number; amountCents: Cents }
  | { kind: 'fractional'; amountCents: Cents; exact: string }
  | { kind: 'low_confidence' };

export type PromptKind = PromptData['kind'];

/** "$350", "$1,500", "$2,500.50": cents shown only when non-zero. */
export function formatUsd(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = rem === 0 ? '' : `.${String(rem).padStart(2, '0')}`;
  return `${sign}$${grouped}${tail}`;
}

function formatTimes(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function heard(text: string): string {
  const clean = text.replace(/"/g, "'").trim();
  return clean.length > MAX_HEARD_CHARS ? clean.slice(0, MAX_HEARD_CHARS) : clean;
}

/** Section 9 templates. Wording only asks or reports; it never states that money is taken. */
export function promptText(data: PromptData): string {
  switch (data.kind) {
    case 'single':
      return `Did you mean ${formatUsd(data.amountCents)} for paddle ${data.paddle}?`;
    case 'device_mic':
      return `Bid ${formatUsd(data.amountCents)}?`;
    case 'two_amounts':
      return `${formatUsd(data.amountACents)} or ${formatUsd(data.amountBCents)} for paddle ${data.paddle}?`;
    case 'two_bidders':
      return `Paddle ${data.paddleA} ${formatUsd(data.amountACents)} or paddle ${data.paddleB} ${formatUsd(data.amountBCents)}?`;
    case 'unknown_bidder':
      return `Which paddle bid ${formatUsd(data.amountCents)}?`;
    case 'unregistered':
      return `Paddle ${data.paddle} is not registered. Who bid ${formatUsd(data.amountCents)}?`;
    case 'homophone':
      return `Heard "${heard(data.text)}". ${formatUsd(data.amountACents)} or ${formatUsd(data.amountBCents)}?`;
    case 'correction':
      return data.fromCents === undefined
        ? `Change paddle ${data.paddle} to ${formatUsd(data.amountCents)}?`
        : `Change paddle ${data.paddle} from ${formatUsd(data.fromCents)} to ${formatUsd(data.amountCents)}?`;
    case 'currency':
      return `Heard ${formatUsd(data.amountCents)} in another currency. Bid ${formatUsd(data.amountCents)} USD?`;
    case 'currency_unparsed':
      return 'That amount was not understood in USD. Please say it in dollars.';
    case 'large_jump':
      return `That is ${formatTimes(data.times)} times the price. Bid ${formatUsd(data.amountCents)}?`;
    case 'fractional':
      return `Bid ${formatUsd(data.amountCents)} (${data.exact})?`;
    case 'low_confidence':
      return DROP_CAPTION;
  }
}
