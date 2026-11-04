import { describe, expect, it } from 'vitest';
import { parseLlmOutput } from '../../src/llm/schema.js';

const good = {
  is_bid: true,
  paddle: '7',
  amount_dollars: 350,
  currency: 'USD',
  alternatives: [],
  is_correction: false,
  negated: false,
  confidence: 0.9,
};

describe('T-VOX-063 LLM output schema (R-VOX-055)', () => {
  it('accepts valid output as an object or a JSON string', () => {
    expect(parseLlmOutput(good)).toEqual(good);
    expect(parseLlmOutput(JSON.stringify(good))).toEqual(good);
    const nulls = { ...good, is_bid: false, paddle: null, amount_dollars: null, currency: null };
    expect(parseLlmOutput(nulls)).toEqual(nulls);
  });

  it('rejects anything else as unavailable', () => {
    expect(parseLlmOutput({ ...good, extra: 1 })).toBeNull();
    expect(parseLlmOutput({ ...good, amount_dollars: 350.5 })).toBeNull();
    expect(parseLlmOutput({ ...good, confidence: 1.2 })).toBeNull();
    expect(parseLlmOutput({ ...good, alternatives: [1, 2, 3, 4] })).toBeNull();
    expect(parseLlmOutput({ ...good, currency: 'EUR' })).toBeNull();
    expect(parseLlmOutput({ ...good, is_bid: undefined })).toBeNull();
    expect(parseLlmOutput('not json')).toBeNull();
    expect(parseLlmOutput(null)).toBeNull();
  });
});
