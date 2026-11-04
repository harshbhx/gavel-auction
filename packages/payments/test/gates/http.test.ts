import { describe, expect, it } from 'vitest';
import { RecordingHttp, type RawFetch } from '../../gates/http.js';

function rig(): { http: RecordingHttp; sent: Array<Parameters<RawFetch>[1]> } {
  const sent: Array<Parameters<RawFetch>[1]> = [];
  const fetch: RawFetch = async (_url, init) => {
    sent.push(init);
    return { status: 201, headers: { forEach: () => undefined }, text: async () => '{}' };
  };
  const http = new RecordingHttp({
    baseUrl: 'http://127.0.0.1:9',
    fake: true,
    gate: 'G1',
    runId: 'r',
    scriptVersion: 't',
    record: () => undefined,
    fetch,
  });
  return { http, sent };
}

describe('RecordingHttp POST payload', () => {
  it('sends {} and a JSON content type on a POST without a body', async () => {
    const { http, sent } = rig();
    await http.request('s', { method: 'POST', path: '/v2/checkout/orders/1/authorize' });
    expect(sent[0]?.body).toBe('{}');
    expect(sent[0]?.headers['Content-Type']).toBe('application/json');
  });

  it('sends no body on a GET', async () => {
    const { http, sent } = rig();
    await http.request('s', { method: 'GET', path: '/v2/x' });
    expect(sent[0]?.body).toBeUndefined();
    expect(sent[0]?.headers['Content-Type']).toBeUndefined();
  });
});
