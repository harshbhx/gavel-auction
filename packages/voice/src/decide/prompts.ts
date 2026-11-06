export const PROMPT_TTL_MS = 10000;
export const PROMPT_RATE_WINDOW_MS = 10000;
/** Prompts one bidder key may open per window (superseded and answered ones do not count). */
export const PROMPT_RATE_MAX = 3;
/** Prompts the whole room may open per window, a larger cap than any one key. */
export const PROMPT_ROOM_MAX = 8;

export type PromptAuditReason = 'confirm_expired' | 'superseded' | 'rate_limited';

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
  roomMax?: number;
  rateWindowMs?: number;
}

/**
 * Open confirm prompts: ttl expiry never confirms, one open prompt per bidder key (a newer one
 * supersedes), and per rate window at most rateMax prompts per key and roomMax per room. Clock is injected.
 */
export class PromptBook<T = unknown> {
  private readonly open_ = new Map<string, OpenPrompt<T>>();
  private shown: Array<{ at: number; key: string; promptId: string }> = [];
  private nextId = 1;
  private droppedCount = 0;
  private readonly ttlMs: number;
  private readonly rateMax: number;
  private readonly roomMax: number;
  private readonly rateWindowMs: number;

  constructor(
    private readonly now: () => number,
    cfg: PromptBookConfig = {},
  ) {
    this.ttlMs = cfg.ttlMs ?? PROMPT_TTL_MS;
    this.rateMax = cfg.rateMax ?? PROMPT_RATE_MAX;
    this.roomMax = cfg.roomMax ?? PROMPT_ROOM_MAX;
    this.rateWindowMs = cfg.rateWindowMs ?? PROMPT_RATE_WINDOW_MS;
  }

  /** Candidates dropped by the rate limit so far. */
  get rateLimited(): number {
    return this.droppedCount;
  }

  get size(): number {
    return this.open_.size;
  }

  /**
   * Opens a prompt. `idHint` (for example the segment idempotency key) makes the id unique across
   * books, so an answer addressed to an older pipeline never lands on this one.
   */
  open(key: string, payload: T, idHint?: string): OpenResult<T> {
    const t = this.now();
    const audit = this.sweep();
    this.shown = this.shown.filter((s) => t - s.at < this.rateWindowMs);
    const older = this.open_.get(key);
    // A prompt this one replaces is not an extra question for the room.
    const counted = this.shown.filter((s) => s.promptId !== older?.promptId);
    if (
      counted.length >= this.roomMax ||
      counted.filter((s) => s.key === key).length >= this.rateMax
    ) {
      this.droppedCount++;
      audit.push({ promptId: '', key, reason: 'rate_limited', atMs: t });
      return { opened: false, audit };
    }
    if (older) {
      audit.push({ promptId: older.promptId, key, reason: 'superseded', atMs: t });
      this.dropShown(older.promptId);
    }
    const prompt: OpenPrompt<T> = {
      promptId:
        idHint === undefined ? `prompt-${this.nextId++}` : `prompt-${idHint}-${this.nextId++}`,
      key,
      openedAtMs: t,
      expiresAtMs: t + this.ttlMs,
      payload,
    };
    this.open_.set(key, prompt);
    this.shown.push({ at: t, key, promptId: prompt.promptId });
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
        out.push({ promptId: p.promptId, key, reason: 'confirm_expired', atMs: t });
      }
    }
    return out;
  }

  private readonly expired = new Set<string>();

  private dropShown(promptId: string): void {
    this.shown = this.shown.filter((s) => s.promptId !== promptId);
  }

  /** Remove a prompt for answering. Expired prompts are rejected, never confirmed. */
  take(promptId: string): TakeResult<T> {
    this.sweep();
    for (const [key, p] of this.open_) {
      if (p.promptId === promptId) {
        this.open_.delete(key);
        // An answered prompt no longer counts against the rate limit.
        this.dropShown(p.promptId);
        return { status: 'ok', prompt: p };
      }
    }
    return { status: this.expired.has(promptId) ? 'expired' : 'unknown' };
  }
}
