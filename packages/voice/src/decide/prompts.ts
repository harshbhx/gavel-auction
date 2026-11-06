export const PROMPT_TTL_MS = 10000;
export const PROMPT_RATE_WINDOW_MS = 10000;
export const PROMPT_RATE_MAX = 3;

export type PromptAuditReason = 'confirm_expired' | 'superseded' | 'low_confidence';

export interface PromptAudit {
  promptId: string;
  key: string;
  reason: PromptAuditReason;
  atMs: number;
}

export interface OpenPrompt<T> {
  promptId: string;
  key: string;
  openedAtMs: number;
  expiresAtMs: number;
  payload: T;
}

export type OpenResult<T> =
  | { opened: true; prompt: OpenPrompt<T>; audit: PromptAudit[] }
  | { opened: false; audit: PromptAudit[] };

export type TakeResult<T> =
  | { status: 'ok'; prompt: OpenPrompt<T> }
  | { status: 'expired' | 'unknown' };

export interface PromptBookConfig {
  ttlMs?: number;
  rateMax?: number;
  rateWindowMs?: number;
}

/**
 * Open confirm prompts: ttl expiry never confirms, one open prompt per bidder key (a newer one
 * supersedes), and at most rateMax prompts per rate window per room. Clock is injected.
 */
/** Expired prompt ids remembered so a late answer is told apart from an unknown id. */
export const EXPIRED_ID_LIMIT = 256;

export class PromptBook<T = unknown> {
  private readonly open_ = new Map<string, OpenPrompt<T>>();
  private shownAt: number[] = [];
  private nextId = 1;
  private droppedCount = 0;
  private readonly ttlMs: number;
  private readonly rateMax: number;
  private readonly rateWindowMs: number;

  constructor(
    private readonly now: () => number,
    cfg: PromptBookConfig = {},
  ) {
    this.ttlMs = cfg.ttlMs ?? PROMPT_TTL_MS;
    this.rateMax = cfg.rateMax ?? PROMPT_RATE_MAX;
    this.rateWindowMs = cfg.rateWindowMs ?? PROMPT_RATE_WINDOW_MS;
  }

  /** Candidates dropped by the rate limit so far. */
  get rateLimited(): number {
    return this.droppedCount;
  }

  /** Expired ids currently remembered (bounded by EXPIRED_ID_LIMIT). */
  get expiredRemembered(): number {
    return this.expired.size;
  }

  get size(): number {
    return this.open_.size;
  }

  open(key: string, payload: T): OpenResult<T> {
    const t = this.now();
    const audit = this.sweep();
    this.shownAt = this.shownAt.filter((s) => t - s < this.rateWindowMs);
    if (this.shownAt.length >= this.rateMax) {
      this.droppedCount++;
      audit.push({ promptId: '', key, reason: 'low_confidence', atMs: t });
      return { opened: false, audit };
    }
    const older = this.open_.get(key);
    if (older) audit.push({ promptId: older.promptId, key, reason: 'superseded', atMs: t });
    const prompt: OpenPrompt<T> = {
      promptId: `prompt-${this.nextId++}`,
      key,
      openedAtMs: t,
      expiresAtMs: t + this.ttlMs,
      payload,
    };
    this.open_.set(key, prompt);
    this.shownAt.push(t);
    return { opened: true, prompt, audit };
  }

  /** Expire due prompts; each yields a confirm_expired audit and is never confirmed. */
  sweep(): PromptAudit[] {
    const t = this.now();
    const out: PromptAudit[] = [];
    for (const [key, p] of this.open_) {
      if (t >= p.expiresAtMs) {
        this.open_.delete(key);
        this.expired.add(p.promptId);
        // Only the most recent ids are remembered; an older late answer reads as unknown.
        if (this.expired.size > EXPIRED_ID_LIMIT) {
          const oldest = this.expired.values().next();
          if (!oldest.done) this.expired.delete(oldest.value);
        }
        out.push({ promptId: p.promptId, key, reason: 'confirm_expired', atMs: t });
      }
    }
    return out;
  }

  private readonly expired = new Set<string>();

  /** Remove a prompt for answering. Expired prompts are rejected, never confirmed. */
  take(promptId: string): TakeResult<T> {
    this.sweep();
    for (const [key, p] of this.open_) {
      if (p.promptId === promptId) {
        this.open_.delete(key);
        return { status: 'ok', prompt: p };
      }
    }
    return { status: this.expired.has(promptId) ? 'expired' : 'unknown' };
  }
}
