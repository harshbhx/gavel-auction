import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PAYPAL_SDK_URL,
  loadPayPalSdkScript,
  resetPayPalSdkLoad,
} from '../../src/payments/paypalV6Adapter';

const scripts = (): HTMLScriptElement[] =>
  [...document.head.querySelectorAll('script')].filter((s) => s.src.includes('paypal'));

function defineSdk(): void {
  (globalThis as unknown as { paypal: unknown }).paypal = {
    createInstance: () => Promise.resolve({}),
  };
}

function removeSdk(): void {
  delete (globalThis as unknown as { paypal?: unknown }).paypal;
}

beforeEach(() => {
  removeSdk();
  resetPayPalSdkLoad();
  scripts().forEach((s) => s.remove());
});

afterEach(() => {
  removeSdk();
  resetPayPalSdkLoad();
  scripts().forEach((s) => s.remove());
});

describe('sandbox SDK host (WEB-RT-03)', () => {
  it('loads the sandbox host, never the live one', () => {
    expect(new URL(PAYPAL_SDK_URL).hostname).toBe('www.sandbox.paypal.com');
    expect(PAYPAL_SDK_URL).not.toMatch(/\/\/www\.paypal\.com/);
    void loadPayPalSdkScript().catch(() => undefined);
    expect(scripts().map((s) => s.src)).toEqual([PAYPAL_SDK_URL]);
  });
});

describe('SDK script loading (WEB-RT-17)', () => {
  it('adds one script tag however many callers ask while it loads', async () => {
    const first = loadPayPalSdkScript();
    const second = loadPayPalSdkScript();
    expect(second).toBe(first);
    expect(scripts()).toHaveLength(1);
    defineSdk();
    scripts()[0]?.onload?.(new Event('load'));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
  });

  it('uses the SDK that is already there without adding a tag', async () => {
    defineSdk();
    await loadPayPalSdkScript();
    expect(scripts()).toHaveLength(0);
  });

  it('removes the dead tag after a failed load and starts clean the next time', async () => {
    const failed = loadPayPalSdkScript();
    scripts()[0]?.onerror?.(new Event('error'));
    await expect(failed).rejects.toThrow('paypal_sdk_load_failed');
    expect(scripts()).toHaveLength(0);

    const retry = loadPayPalSdkScript();
    expect(scripts()).toHaveLength(1);
    defineSdk();
    scripts()[0]?.onload?.(new Event('load'));
    await expect(retry).resolves.toBeDefined();
  });

  it('rejects a global that does not look like the SDK', async () => {
    const loading = loadPayPalSdkScript();
    (globalThis as unknown as { paypal: unknown }).paypal = { somethingElse: true };
    scripts()[0]?.onload?.(new Event('load'));
    await expect(loading).rejects.toThrow('paypal_sdk_missing');
    expect(scripts()).toHaveLength(0);
  });

  it('asks for the script without credentials or a referrer', () => {
    void loadPayPalSdkScript().catch(() => undefined);
    const tag = scripts()[0];
    expect(tag?.crossOrigin).toBe('anonymous');
    expect(tag?.referrerPolicy).toBe('no-referrer');
  });
});
