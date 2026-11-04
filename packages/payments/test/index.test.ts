import { describe, expect, it } from 'vitest';
import * as pkg from '@gavel/payments';
import { FakePayPalServer } from '@gavel/payments/fake';

describe('package entry', () => {
  it('exports the clients, saga, stores and gateway under the package name', () => {
    for (const name of [
      'TokenManager',
      'Transport',
      'OrdersClient',
      'PaymentsApiClient',
      'PayPalGateway',
      'WebhookVerifier',
      'WebhookHandler',
      'createWebhookHandler',
      'HoldService',
      'CapturePhase',
      'createSettlement',
      'step',
      'planFromOutcome',
      'planWithSkipped',
      'guardGateway',
      'PersistentKillSwitch',
      'FileJournalStore',
      'MemoryJournalStore',
      'JournalExists',
      'VersionConflict',
      'withLease',
      'reconcile',
      'voidAllLiveHolds',
      'releaseWinnerRemainder',
      'settlementUpdateFor',
      'runSettlement',
    ]) {
      expect(typeof (pkg as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('exposes the fake server under the fake subpath', () => {
    expect(typeof FakePayPalServer).toBe('function');
  });
});
