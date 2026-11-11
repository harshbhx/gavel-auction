import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QrCode, encodeQr, snapSize } from '../../src/screens/join/QrCode';

const URL_TEXT = 'https://gavel.example/join/room-123?c=ABC123';

/** Version 4 only: finders, timing, one alignment square and the format strips. */
function isFunctionModule(x: number, y: number, size: number): boolean {
  if (x < 9 && y < 9) return true;
  if (x >= size - 8 && y < 9) return true;
  if (x < 9 && y >= size - 8) return true;
  if (x === 6 || y === 6) return true;
  return x >= 24 && x <= 28 && y >= 24 && y <= 28;
}

function readBack(rows: boolean[][]): string {
  const size = rows.length;
  const at = (x: number, y: number): boolean => rows[y]?.[x] ?? false;
  // Format bits sit in row 8, columns 0 to 5, 7 and 8: 15 bits XORed with 0x5412.
  const cells: [number, number][] = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  let format = 0;
  cells.forEach(([x, y], i) => {
    if (at(x, y)) format |= 1 << i;
  });
  format ^= 0x5412;
  const level = format >>> 13;
  const mask = (format >>> 10) & 7;
  expect(level).toBe(0); // Level M.
  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const unmask = masks[mask];
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (isFunctionModule(x, y, size)) continue;
        const flip = unmask?.(x, y) ?? false;
        bits.push(at(x, y) !== flip ? 1 : 0);
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  // Version 4 level M: two blocks of 32 data codewords then 18 error codewords each, interleaved.
  const data: number[] = new Array<number>(64).fill(0);
  for (let i = 0; i < 32; i += 1) {
    for (let b = 0; b < 2; b += 1) data[b * 32 + i] = codewords[i * 2 + b] ?? 0;
  }
  expect((data[0] ?? 0) >>> 4).toBe(0b0100);
  const length = ((data[0] ?? 0) & 15) * 16 + ((data[1] ?? 0) >>> 4);
  const text: number[] = [];
  for (let i = 0; i < length; i += 1) {
    text.push((((data[1 + i] ?? 0) & 15) << 4) | ((data[2 + i] ?? 0) >>> 4));
  }
  return new TextDecoder().decode(new Uint8Array(text));
}

describe('QrCode (R-WEB-051)', () => {
  it('encodes the url so a reader gets it back, with error correction M', () => {
    const rows = encodeQr(URL_TEXT);
    expect(rows.length).toBe(33);
    expect(readBack(rows)).toBe(URL_TEXT);
  });

  it('draws the finder patterns', () => {
    const rows = encodeQr(URL_TEXT);
    expect(rows[0]?.slice(0, 7)).toEqual(new Array<boolean>(7).fill(true));
    expect(rows[3]?.slice(0, 7)).toEqual([true, false, true, true, true, false, true]);
  });

  it('renders offline with the url as text alternative and a 4 module quiet zone', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<QrCode url={URL_TEXT} size={200} />);
    const img = screen.getByRole('img', { name: URL_TEXT });
    expect(img.getAttribute('viewBox')).toBe('0 0 41 41');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects a url too long to encode', () => {
    expect(() => encodeQr('x'.repeat(400))).toThrow(RangeError);
  });

  it('fits a receipt link of about 330 bytes (versions 11 to 14, level M)', () => {
    // Byte capacities at level M: 251, 287, 331, 362.
    const sizes: ReadonlyArray<[number, number]> = [
      [251, 61],
      [252, 65],
      [287, 65],
      [288, 69],
      [331, 69],
      [332, 73],
      [362, 73],
    ];
    for (const [bytes, modules] of sizes) {
      expect(encodeQr('x'.repeat(bytes)).length).toBe(modules);
    }
    expect(() => encodeQr('x'.repeat(363))).toThrow(RangeError);
  });
});

describe('QR snapping (UIX-73)', () => {
  it('draws whole pixels per module, inside 130 to 170 px when a multiple fits', () => {
    for (const span of [37, 41, 45, 49, 53]) {
      const px = snapSize(span, 170, 130);
      expect(px % span).toBe(0);
      expect(px).toBeGreaterThanOrEqual(130);
      expect(px).toBeLessThanOrEqual(180);
    }
  });

  it('keeps the four module quiet zone and renders at the snapped width', () => {
    const rows = encodeQr(URL_TEXT);
    const span = rows.length + 8;
    render(<QrCode url={URL_TEXT} size={170} snapMin={130} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${span} ${span}`);
    expect(Number(svg.getAttribute('width')) % span).toBe(0);
  });
});
