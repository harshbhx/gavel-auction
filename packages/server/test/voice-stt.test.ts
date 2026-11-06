import type { WsFactory } from '@gavel/voice';
import { describe, expect, it } from 'vitest';
import { chooseStt } from '../src/voice/stt';
import { parseConfig } from '../src/config';

describe('speech provider choice (HRD-67)', () => {
  it('uses the cached provider with no config and no key', () => {
    expect(chooseStt({}).name).toBe('replay');
    expect(chooseStt({ VOICE_STT: '' }).make().name).toBe('replay');
    expect(chooseStt({ VOICE_STT: 'replay' }).make().name).toBe('replay');
  });

  it('keeps the cached provider when a live one is named without its key', () => {
    const logged: string[] = [];
    const choice = chooseStt({ VOICE_STT: 'groq' }, { log: (m) => logged.push(m) });
    expect(choice.name).toBe('replay');
    expect(logged).toHaveLength(1);
  });

  it('runs a live provider behind failover only when its key is set', () => {
    const choice = chooseStt(
      { VOICE_STT: 'groq', GROQ_API_KEY: 'k' },
      { fetch: () => Promise.reject(new Error('no network in tests')) },
    );
    expect(choice.name).toBe('groq');
    expect(choice.make().name).toBe('groq');
  });

  it('boots without any speech setting, in production too', () => {
    const base = {
      PUBLIC_URL: 'https://gavel.example.com',
      TOKEN_SECRET: 'x'.repeat(40),
      ADMIN_KEY: 'y'.repeat(40),
      NODE_ENV: 'production',
      STORE: 'memory',
      ALLOW_MEMORY_STORE: '1',
      PAYMENTS: 'sandbox',
      PAYPAL_CLIENT_ID: 'client-id-value',
      PAYPAL_CLIENT_SECRET: 'cs-val',
      PAYPAL_WEBHOOK_ID: 'webhook-id-value',
    };
    expect(parseConfig(base).ok).toBe(true);
    expect(parseConfig({ ...base, VOICE_STT: 'groq' }).ok).toBe(true);
    expect(parseConfig({ ...base, VOICE_STT: 'nope' }).ok).toBe(false);
  });

  it('runs deepgram behind failover when its key is set and a socket is available', () => {
    const socket: WsFactory = () => {
      throw new Error('no network in tests');
    };
    const choice = chooseStt({ VOICE_STT: 'deepgram', DEEPGRAM_API_KEY: 'k' }, { socket });
    expect(choice.name).toBe('deepgram');
    expect(choice.make().name).toBe('deepgram');
    const missing = chooseStt({ VOICE_STT: 'deepgram' }, { socket });
    expect(missing.name).toBe('replay');
  });
});
