import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './errors';

const REDACTED = '[redacted]';
const BEARER_RE = /\bBearer\s+[^\s"',;]+/gi;
const TOKEN_RE = /[A-Za-z0-9_\-.+/=]{32,}/g;
const STACK_LINE_RE = /^[ \t]*at\s.+$/gm;

/** Remove bearer tokens, token-like strings and stack trace lines from free text. */
export function scrubMessage(text: string): string {
  return text
    .replace(STACK_LINE_RE, '')
    .replace(BEARER_RE, REDACTED)
    .replace(TOKEN_RE, REDACTED)
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const clean = (text: string): boolean => scrubMessage(text) === text;

export const ApiErrorSchema = z
  .object({
    code: z.enum(ERROR_CODES),
    message: z.string().refine(clean, 'message must not contain tokens, secrets or stack traces'),
    detail: z
      .string()
      .refine(clean, 'detail must not contain tokens, secrets or stack traces')
      .optional(),
  })
  .strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Build an ApiError, scrubbing message and detail first. */
export function makeApiError(code: ErrorCode, message: string, detail?: string): ApiError {
  const out: ApiError = { code, message: scrubMessage(message) };
  if (detail !== undefined) out.detail = scrubMessage(detail);
  return ApiErrorSchema.parse(out);
}
