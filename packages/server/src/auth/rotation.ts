import {
  signToken,
  verifyToken,
  type TokenPayload,
  type VerifyOptions,
  type VerifyResult,
} from './token';

export interface SecretConfig {
  TOKEN_SECRET: string;
  TOKEN_SECRET_PREVIOUS?: string | undefined;
  /** Epoch ms after which the previous secret is no longer accepted; absent means no end. */
  TOKEN_SECRET_PREVIOUS_UNTIL?: number | undefined;
}

/** The secrets in play during a rotation (R-RT-082). */
export interface SecretSet {
  /** The only secret used to sign. */
  readonly current: string;
  /** Secrets accepted for verification: current first, then the previous one. */
  readonly verifying: readonly string[];
  /** The previous secret stops verifying at this time (epoch ms); absent means it never does. */
  readonly previousUntilMs?: number;
  /** Called after a token verified only under the previous secret, so the host can count it. */
  readonly onPreviousUse?: () => void;
}

/** Build the secret set from config. A previous secret equal to the current one is dropped. */
export function secretSetFromConfig(cfg: SecretConfig): SecretSet {
  const prev = cfg.TOKEN_SECRET_PREVIOUS;
  const verifying =
    prev !== undefined && prev !== '' && prev !== cfg.TOKEN_SECRET
      ? [cfg.TOKEN_SECRET, prev]
      : [cfg.TOKEN_SECRET];
  const until = cfg.TOKEN_SECRET_PREVIOUS_UNTIL;
  return {
    current: cfg.TOKEN_SECRET,
    verifying,
    ...(until !== undefined && verifying.length > 1 ? { previousUntilMs: until } : {}),
  };
}

/** Sign with the current secret only. */
export function signWithCurrent(payload: TokenPayload, secrets: SecretSet): Promise<string> {
  return signToken(payload, secrets.current);
}

/** Verify against the current and previous secrets. */
export async function verifyRotating(
  token: string,
  secrets: SecretSet,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  // After its end time the previous secret is dropped: a leaked old secret must not outlive
  // the longest token (R-RT-082).
  const expired = secrets.previousUntilMs !== undefined && opts.nowMs >= secrets.previousUntilMs;
  const list = expired ? secrets.verifying.slice(0, 1) : secrets.verifying;
  const result = await verifyToken(token, list, opts);
  if (result.ok && result.viaPrevious === true) secrets.onPreviousUse?.();
  return result;
}
