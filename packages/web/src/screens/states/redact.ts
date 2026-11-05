const REDACTED = '[redacted]';

/** Bearer values, long token-like runs and PayPal-style ids (12 or more upper-case letters and digits with a digit). */
const PATTERNS: readonly RegExp[] = [
  /\bBearer\s+\S+/gi,
  /\b[A-Za-z0-9_\-.=]{24,}\b/g,
  /\b(?=[A-Z0-9]*\d)[A-Z0-9]{12,}\b/g,
];

/** Removes secrets, tokens and full ids from text shown in error details (R-WEB-108). */
export function redactDetail(text: string): string {
  return PATTERNS.reduce((acc, re) => acc.replace(re, REDACTED), text);
}

/** Last 8 characters of a correlation id, so support can match it without exposing the whole value. */
export function shortRef(id: string): string {
  const clean = redactDetail(id.length > 8 ? id.slice(-8) : id);
  return clean;
}
