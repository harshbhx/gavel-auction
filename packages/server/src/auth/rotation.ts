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
}

/** The secrets in play during a rotation (R-RT-082). */
export interface SecretSet {
  /** The only secret used to sign. */
  readonly current: string;
  /** Secrets accepted for verification: current first, then the previous one. */
  readonly verifying: readonly string[];
}

/** Build the secret set from config. A previous secret equal to the current one is dropped. */
export function secretSetFromConfig(cfg: SecretConfig): SecretSet {
  const prev = cfg.TOKEN_SECRET_PREVIOUS;
  const verifying =
    prev !== undefined && prev !== '' && prev !== cfg.TOKEN_SECRET
      ? [cfg.TOKEN_SECRET, prev]
      : [cfg.TOKEN_SECRET];
  return { current: cfg.TOKEN_SECRET, verifying };
}

/** Sign with the current secret only. */
export function signWithCurrent(payload: TokenPayload, secrets: SecretSet): Promise<string> {
  return signToken(payload, secrets.current);
}

/** Verify against the current and previous secrets. */
export function verifyRotating(
  token: string,
  secrets: SecretSet,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  return verifyToken(token, secrets.verifying, opts);
}
