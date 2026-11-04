import type {
  HoldRecord,
  HoldTruth,
  Journal,
  KillState,
  PaymentAudit,
  StoredWebhook,
} from './types.js';

/**
 * Gateway to the payment processor.
 * Outcome notes: a PayPalError with outcome "definite" means the processor
 * refused or the request provably did not take effect. outcome "unknown"
 * (timeouts, 5xx, exhausted retries on POSTs) means the effect may or may not
 * have happened; callers must run getHoldTruth before acting.
 */
export interface PaymentsGateway {
  /** POST. Unknown outcome on network/5xx: the order may exist. */
  createOrder(i: {
    holdId: string;
    ceilingCents: number;
    description: string;
    requestId: string;
  }): Promise<{ orderId: string; approveUrl?: string }>;
  /** Read. Never changes state; failures are transient. */
  getOrder(orderId: string): Promise<{ orderId: string; status: string; authId?: string }>;
  /** POST. Unknown outcome: the authorization may exist; read the order. */
  authorizeOrder(
    orderId: string,
    requestId: string,
  ): Promise<{ authId: string; amountCents: number }>;
  /** Read. The only source of truth the saga trusts after an unknown outcome. */
  getHoldTruth(h: { holdId: string; authId: string; orderId?: string }): Promise<HoldTruth>;
  /** POST. Unknown outcome: money may have moved; check getHoldTruth. */
  capture(
    authId: string,
    i: { amountCents: number; finalCapture: boolean; invoiceId: string; requestId: string },
  ): Promise<{ captureId: string; amountCents: number }>;
  /** POST. Definite on 2xx and on already_voided/expired/not_found; unknown otherwise. */
  voidAuthorization(authId: string, requestId: string): Promise<void>;
  /** POST. Unknown outcome: the authorization amount may have changed. */
  reauthorize(
    authId: string,
    i: { amountCents: number; requestId: string },
  ): Promise<{ amountCents: number }>;
}

export interface JournalStore {
  /** Returns null when no journal exists. */
  load(auctionId: string): Promise<Journal | null>;
  /** Fails if a journal for the auction exists. */
  create(j: Journal): Promise<void>;
  /** Compare-and-set on version; throws VersionConflict. */
  save(j: Journal, expectedVersion: number): Promise<void>;
  /** True when the lease was granted to owner. */
  acquireLease(auctionId: string, owner: string, ttlMs: number, nowMs: number): Promise<boolean>;
  releaseLease(auctionId: string, owner: string): Promise<void>;
}

export interface WebhookEventStore {
  /** True when the event was new. Durable before returning. */
  insertIfAbsent(e: StoredWebhook): Promise<boolean>;
  markProcessed(id: string, result: string): Promise<void>;
  parkOrphan(id: string, untilMs: number): Promise<void>;
  listOrphans(nowMs: number): Promise<StoredWebhook[]>;
}

export interface HoldStore {
  get(holdId: string): Promise<HoldRecord | null>;
  byBidder(auctionId: string, bidderId: string): Promise<HoldRecord | null>;
  put(h: HoldRecord): Promise<void>;
  listByAuction(auctionId: string): Promise<HoldRecord[]>;
}

export interface AuditSink {
  /** One entry per money call and per state change. */
  append(e: PaymentAudit): Promise<void>;
}

export interface Clock {
  nowMs(): number;
}

export interface KillSwitch {
  isEngaged(): Promise<KillState>;
  /** Persisted; audited with the actor. */
  engage(reason: string, by: string): Promise<void>;
  /** Persisted; audited with the actor. */
  release(by: string): Promise<void>;
}

export type Labels = Record<string, string>;

export interface PaymentsMetrics {
  /** Counters: paypal_calls_total, paypal_retries_total, settlement_transitions_total, webhook_events_total, reconcile_findings_total. */
  incr(name: string, labels?: Labels, by?: number): void;
  /** Histograms: paypal_latency_ms. */
  observe(name: string, value: number, labels?: Labels): void;
  /** Text snapshot for the ops page. */
  snapshot(): string;
}
