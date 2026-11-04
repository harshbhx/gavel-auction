import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PayPalError } from './errors.js';
import type { AuditSink, Clock, KillSwitch, PaymentsGateway } from './ports.js';
import type { KillState } from './types.js';

/**
 * Kill switch (SPEC 3.9, R-PAY-006, R-PAY-110, R-PAY-111, R-PAY-113).
 *
 * The state lives in a small persisted store so it survives a restart. Engage and
 * release are audited with the actor. `guardGateway` wraps a PaymentsGateway so
 * that the money-moving calls (createOrder, authorizeOrder, capture, reauthorize)
 * throw `kill_switch_engaged` before they reach the wrapped gateway and so before
 * the network. voidAuthorization and every read pass through untouched.
 */

export interface KillStateStore {
  load(): Promise<KillState>;
  save(state: KillState): Promise<void>;
}

const RELEASED: KillState = { engaged: false };

export class MemoryKillStateStore implements KillStateStore {
  private state: KillState;

  constructor(initial: KillState = RELEASED) {
    this.state = { ...initial };
  }

  async load(): Promise<KillState> {
    return { ...this.state };
  }

  async save(state: KillState): Promise<void> {
    this.state = { ...state };
  }
}

/** One JSON file, written atomically (temp file then rename). */
export class FileKillStateStore implements KillStateStore {
  constructor(readonly path: string) {}

  async load(): Promise<KillState> {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...RELEASED };
      throw e;
    }
    return JSON.parse(text) as KillState;
  }

  async save(state: KillState): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), 'utf8');
    renameSync(tmp, this.path);
  }
}

export interface PersistentKillSwitchDeps {
  store: KillStateStore;
  audit: AuditSink;
  clock: Clock;
}

export class PersistentKillSwitch implements KillSwitch {
  constructor(private readonly deps: PersistentKillSwitchDeps) {}

  isEngaged(): Promise<KillState> {
    return this.deps.store.load();
  }

  /** Persists first, then audits: the block is in force even if the audit sink fails. */
  async engage(reason: string, by: string): Promise<void> {
    const sinceMs = this.deps.clock.nowMs();
    await this.deps.store.save({ engaged: true, reason, by, sinceMs });
    await this.deps.audit.append({
      kind: 'kill_switch',
      label: `engage:${reason}`,
      to: 'engaged',
      actor: by,
      tsMs: sinceMs,
    });
  }

  /** Persists first, then audits. Releasing a released switch is harmless and still audited. */
  async release(by: string): Promise<void> {
    const tsMs = this.deps.clock.nowMs();
    await this.deps.store.save({ ...RELEASED });
    await this.deps.audit.append({
      kind: 'kill_switch',
      label: 'release',
      to: 'released',
      actor: by,
      tsMs,
    });
  }
}

/** The error a blocked money call throws. */
export function killSwitchError(state: KillState): PayPalError {
  const why = state.reason === undefined ? '' : `: ${state.reason}`;
  return new PayPalError({
    kind: 'kill_switch_engaged',
    status: 0,
    name: 'KILL_SWITCH_ENGAGED',
    message: `payments kill switch is engaged${why}`,
    outcome: 'definite',
  });
}

/** Throws kill_switch_engaged when the switch is engaged. Call before any money-moving work. */
export async function assertNotEngaged(ks: KillSwitch): Promise<void> {
  const state = await ks.isEngaged();
  if (state.engaged) throw killSwitchError(state);
}

/**
 * Wraps a gateway so money-moving calls are refused while the switch is engaged.
 * The switch is read on every call, so an engage takes effect on the next call.
 */
export function guardGateway(gateway: PaymentsGateway, ks: KillSwitch): PaymentsGateway {
  return {
    async createOrder(i) {
      await assertNotEngaged(ks);
      return gateway.createOrder(i);
    },
    getOrder: (orderId) => gateway.getOrder(orderId),
    async authorizeOrder(orderId, requestId) {
      await assertNotEngaged(ks);
      return gateway.authorizeOrder(orderId, requestId);
    },
    getHoldTruth: (h) => gateway.getHoldTruth(h),
    async capture(authId, i) {
      await assertNotEngaged(ks);
      return gateway.capture(authId, i);
    },
    voidAuthorization: (authId, requestId) => gateway.voidAuthorization(authId, requestId),
    async reauthorize(authId, i) {
      await assertNotEngaged(ks);
      return gateway.reauthorize(authId, i);
    },
  };
}
