import { useMemo } from 'react';

/**
 * A QR code drawn in the browser with no network request and no library (R-WEB-051). Byte mode,
 * error correction level M, a four module quiet zone, and the URL as the accessible text. Load it
 * with React.lazy so the encoder stays out of the main chunk.
 */

/** Quiet zone, in modules, on every side. */
const QUIET = 4;
const MAX_VERSION = 10;

/** Per version: [ecc codewords per block, blocks of the short size, short size, blocks of long size]. */
const BLOCKS: readonly (readonly [number, number, number, number])[] = [
  [10, 1, 16, 0],
  [16, 1, 28, 0],
  [26, 1, 44, 0],
  [18, 2, 32, 0],
  [24, 2, 43, 0],
  [16, 4, 27, 0],
  [18, 4, 31, 0],
  [22, 2, 38, 2],
  [22, 3, 36, 2],
  [26, 4, 43, 1],
];

const ALIGN: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function dataCodewords(version: number): number {
  const [, shortCount, shortSize, longCount] = BLOCKS[version - 1] ?? [0, 0, 0, 0];
  return shortCount * shortSize + longCount * (shortSize + 1);
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function pickVersion(byteCount: number): number {
  for (let v = 1; v <= MAX_VERSION; v += 1) {
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + byteCount * 8 <= dataCodewords(v) * 8) return v;
  }
  throw new RangeError('url too long for the QR renderer');
}

function bitsOf(bytes: readonly number[], version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, count: number): void => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  return bits;
}

function toBytes(bits: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i + j] ?? 0);
    out.push(value);
  }
  return out;
}

function gfMultiply(a: number, b: number): number {
  let result = 0;
  for (let i = 7; i >= 0; i -= 1) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    if (((b >>> i) & 1) !== 0) result ^= a;
  }
  return result;
}

function divisor(degree: number): number[] {
  const poly: number[] = new Array<number>(degree).fill(0);
  poly[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      poly[j] = gfMultiply(poly[j] ?? 0, root) ^ (poly[j + 1] ?? 0);
    }
    root = gfMultiply(root, 2);
  }
  return poly;
}

function remainder(data: readonly number[], poly: readonly number[]): number[] {
  const result: number[] = new Array<number>(poly.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    poly.forEach((coef, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

/** Splits the data into blocks, adds error correction to each and interleaves them. */
function interleave(data: readonly number[], version: number): number[] {
  const [eccLen, shortCount, shortSize, longCount] = BLOCKS[version - 1] ?? [0, 0, 0, 0];
  const poly = divisor(eccLen);
  const dataBlocks: number[][] = [];
  let at = 0;
  for (let i = 0; i < shortCount + longCount; i += 1) {
    const size = i < shortCount ? shortSize : shortSize + 1;
    dataBlocks.push(data.slice(at, at + size));
    at += size;
  }
  const eccBlocks = dataBlocks.map((block) => remainder(block, poly));
  const out: number[] = [];
  for (let i = 0; i < shortSize + 1; i += 1) {
    dataBlocks.forEach((block) => {
      const value = block[i];
      if (value !== undefined) out.push(value);
    });
  }
  for (let i = 0; i < eccLen; i += 1) eccBlocks.forEach((block) => out.push(block[i] ?? 0));
  return out;
}

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];

  constructor(size: number) {
    this.size = size;
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  get(x: number, y: number): boolean {
    return this.dark[y]?.[x] ?? false;
  }

  setFunction(x: number, y: number, value: boolean): void {
    const row = this.dark[y];
    const lock = this.fixed[y];
    if (row === undefined || lock === undefined || x < 0 || x >= this.size) return;
    row[x] = value;
    lock[x] = true;
  }

  isFixed(x: number, y: number): boolean {
    return this.fixed[y]?.[x] ?? false;
  }

  flip(x: number, y: number): void {
    const row = this.dark[y];
    if (row !== undefined) row[x] = !(row[x] ?? false);
  }
}

const bit = (value: number, i: number): boolean => ((value >>> i) & 1) !== 0;

function drawFinder(grid: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      grid.setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(grid: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      grid.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFormat(grid: Grid, mask: number): void {
  const data = mask; // Error correction level M is 0b00.
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const size = grid.size;
  for (let i = 0; i <= 5; i += 1) grid.setFunction(8, i, bit(bits, i));
  grid.setFunction(8, 7, bit(bits, 6));
  grid.setFunction(8, 8, bit(bits, 7));
  grid.setFunction(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i += 1) grid.setFunction(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i += 1) grid.setFunction(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i += 1) grid.setFunction(8, size - 15 + i, bit(bits, i));
  grid.setFunction(8, size - 8, true);
}

function drawVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i += 1) {
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.setFunction(a, b, bit(bits, i));
    grid.setFunction(b, a, bit(bits, i));
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  for (let i = 0; i < size; i += 1) {
    grid.setFunction(6, i, i % 2 === 0);
    grid.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  const positions = ALIGN[version - 1] ?? [];
  const last = positions.length - 1;
  positions.forEach((py, i) => {
    positions.forEach((px, j) => {
      const corner = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!corner) drawAlignment(grid, px, py);
    });
  });
  drawFormat(grid, 0);
  drawVersion(grid, version);
}

function placeData(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  let i = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!grid.isFixed(x, y) && i < total) {
          const row = grid.dark[y];
          if (row !== undefined) row[x] = bit(codewords[i >>> 3] ?? 0, 7 - (i & 7));
          i += 1;
        }
      }
    }
  }
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y += 1) {
    for (let x = 0; x < grid.size; x += 1) {
      if (!grid.isFixed(x, y) && maskApplies(mask, x, y)) grid.flip(x, y);
    }
  }
}

function lineRuns(line: readonly boolean[]): number {
  let score = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i += 1) {
    if (i < line.length && line[i] === line[i - 1]) {
      run += 1;
    } else {
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
  }
  const text = line.map((d) => (d ? '1' : '0')).join('');
  for (const pattern of ['00001011101', '10111010000']) {
    for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) score += 40;
  }
  return score;
}

function penalty(grid: Grid): number {
  const n = grid.size;
  let score = 0;
  let darkCount = 0;
  for (let y = 0; y < n; y += 1) {
    const row: boolean[] = [];
    const col: boolean[] = [];
    for (let x = 0; x < n; x += 1) {
      row.push(grid.get(x, y));
      col.push(grid.get(y, x));
      if (grid.get(x, y)) darkCount += 1;
      if (x + 1 < n && y + 1 < n) {
        const v = grid.get(x, y);
        if (v === grid.get(x + 1, y) && v === grid.get(x, y + 1) && v === grid.get(x + 1, y + 1)) {
          score += 3;
        }
      }
    }
    score += lineRuns(row) + lineRuns(col);
  }
  const total = n * n;
  score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** Encodes text as a QR symbol (level M, byte mode). Returns rows of dark modules. */
export function encodeQr(text: string): boolean[][] {
  const bytes = utf8(text);
  const version = pickVersion(bytes.length);
  const codewords = interleave(toBytes(bitsOf(bytes, version)), version);
  const size = 17 + 4 * version;
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = new Grid(size);
    drawFunctionPatterns(grid, version);
    placeData(grid, codewords);
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      best = grid;
      bestScore = score;
    }
  }
  return best === null ? [] : best.dark;
}

export interface QrCodeProps {
  url: string;
  /** Rendered width and height in CSS pixels, quiet zone included. */
  size: number;
}

export function QrCode({ url, size }: QrCodeProps): JSX.Element {
  const rows = useMemo(() => encodeQr(url), [url]);
  const path = useMemo(() => {
    const parts: string[] = [];
    rows.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) parts.push(`M${x + QUIET} ${y + QUIET}h1v1h-1z`);
      }),
    );
    return parts.join('');
  }, [rows]);
  const span = rows.length + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={url}
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
    >
      <title>{url}</title>
      <rect width={span} height={span} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

export default QrCode;
