import { describe, expect, it } from 'vitest';
import { LevelMeter } from '../../src/audio/meter.js';

const SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = (SAMPLE_RATE * 100) / 1000;

function sineTone(amplitude: number, samples: number): Int16Array {
  const buf = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    buf[i] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE));
  }
  return buf;
}

function silence(samples: number): Int16Array {
  return new Int16Array(samples);
}

function fullScaleSquare(samples: number): Int16Array {
  const buf = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    buf[i] = i % 2 === 0 ? 32767 : -32767;
  }
  return buf;
}

describe('LevelMeter (T-VOX-010)', () => {
  it('sine amplitude 0.5 produces about -9 dBFS (RMS)', () => {
    const meter = new LevelMeter();
    const tone = sineTone(0.5, WINDOW_SAMPLES);
    const reading = meter.push(tone);
    expect(reading).not.toBeNull();
    expect(reading?.rmsDbfs).toBeGreaterThan(-9.5);
    expect(reading?.rmsDbfs).toBeLessThan(-8.5);
    expect(reading?.clipping).toBe(false);
  });

  it('sine amplitude 1.0 produces about -3 dBFS (RMS)', () => {
    const meter = new LevelMeter();
    const tone = sineTone(1.0, WINDOW_SAMPLES);
    const reading = meter.push(tone);
    expect(reading).not.toBeNull();
    expect(reading?.rmsDbfs).toBeGreaterThan(-3.5);
    expect(reading?.rmsDbfs).toBeLessThan(-2.5);
  });

  it('full scale square wave triggers clipping', () => {
    const meter = new LevelMeter();
    const wave = fullScaleSquare(WINDOW_SAMPLES);
    const reading = meter.push(wave);
    expect(reading).not.toBeNull();
    expect(reading?.clipping).toBe(true);
  });

  it('silence clamps to -90 dBFS', () => {
    const meter = new LevelMeter();
    const buf = silence(WINDOW_SAMPLES);
    const reading = meter.push(buf);
    expect(reading).not.toBeNull();
    expect(reading?.rmsDbfs).toBe(-90);
    expect(reading?.normalized).toBe(0);
    expect(reading?.clipping).toBe(false);
  });

  it('normalized is between 0 and 1', () => {
    const meter = new LevelMeter();
    const tone = sineTone(0.5, WINDOW_SAMPLES);
    const reading = meter.push(tone);
    expect(reading).not.toBeNull();
    expect(reading?.normalized).toBeGreaterThan(0);
    expect(reading?.normalized).toBeLessThanOrEqual(1);
  });

  it('returns null when not enough samples for a window', () => {
    const meter = new LevelMeter();
    const partial = sineTone(0.5, 100);
    expect(meter.push(partial)).toBeNull();
  });

  it('clipping requires 3 consecutive samples at or above 32700', () => {
    const meter = new LevelMeter();
    const buf = new Int16Array(WINDOW_SAMPLES);
    buf[0] = 32700;
    buf[1] = 32700;
    buf[2] = 0;
    buf[3] = 32700;
    buf[4] = 32700;
    const reading = meter.push(buf);
    expect(reading?.clipping).toBe(false);
  });

  it('clipping detects exactly 3 consecutive clips', () => {
    const meter = new LevelMeter();
    const buf = new Int16Array(WINDOW_SAMPLES);
    buf[0] = 32700;
    buf[1] = 32700;
    buf[2] = 32700;
    const reading = meter.push(buf);
    expect(reading?.clipping).toBe(true);
  });
});
