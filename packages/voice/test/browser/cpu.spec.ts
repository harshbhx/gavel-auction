/**
 * Informational capture CPU run (T-VOX-112, R-VOX-104). Not part of the unit suite: the file name does
 * not match *.test.ts, so vitest skips it. The voice-browser workflow runs it in Actions with
 *   node --experimental-strip-types packages/voice/test/browser/cpu.spec.ts
 * and Playwright installed outside the repository (PLAYWRIGHT_MODULE points at its entry file).
 *
 * Chromium feeds a synthetic tone through the fake-device flags into a worklet that frames audio into
 * 20 ms blocks. CPU time of the browser processes is read over the DevTools protocol, once for an idle
 * graph (baseline) and once with the worklet, so the difference is the worklet cost. The run fails only
 * above FAIL_ABOVE_PERCENT; the 5 percent target is reported, not enforced.
 */
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const TARGET_PERCENT = 5;
const FAIL_ABOVE_PERCENT = 15;
const BASELINE_SECONDS = 10;
const MEASURE_SECONDS = Number(process.env['VOICE_CPU_SECONDS'] ?? '60');

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}
interface PageLike {
  evaluate(expr: string): Promise<unknown>;
  context(): { newCDPSession(page: PageLike): Promise<CdpSession> };
  goto(url: string): Promise<unknown>;
}
interface BrowserLike {
  newContext(opts: { permissions: string[] }): Promise<{ newPage(): Promise<PageLike> }>;
  close(): Promise<void>;
}
interface PlaywrightLike {
  chromium: { launch(opts: { args: string[]; headless: boolean }): Promise<BrowserLike> };
}

function isPlaywright(v: unknown): v is PlaywrightLike {
  return typeof v === 'object' && v !== null && 'chromium' in v;
}

async function loadPlaywright(): Promise<PlaywrightLike> {
  const spec = process.env['PLAYWRIGHT_MODULE'] ?? 'playwright';
  const mod: unknown = await import(spec);
  if (isPlaywright(mod)) return mod;
  if (typeof mod === 'object' && mod !== null && 'default' in mod && isPlaywright(mod.default)) {
    return mod.default;
  }
  throw new Error('PLAYWRIGHT_MODULE does not export chromium');
}

const WORKLET_SOURCE = `
class FrameProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(320); this.fill = 0; this.frames = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.fill++] = s < 0 ? s * 32768 : s * 32767;
      if (this.fill === 320) {
        this.frames++;
        if (this.frames % 5 === 0) this.port.postMessage(this.buf.slice(0));
        this.fill = 0;
      }
    }
    return true;
  }
}
registerProcessor('frame-processor', FrameProcessor);
`;

const PAGE_SETUP = `(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([${JSON.stringify(WORKLET_SOURCE)}], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'frame-processor');
  const quiet = ctx.createGain();
  quiet.gain.value = 0;
  src.connect(node);
  node.connect(quiet);
  quiet.connect(ctx.destination);
  window.__gavel = { ctx, src, node, batches: 0 };
  node.port.onmessage = () => { window.__gavel.batches += 1; };
  await ctx.resume();
  return ctx.state;
})()`;

async function cpuSeconds(cdp: CdpSession): Promise<number> {
  const info = await cdp.send('SystemInfo.getProcessInfo');
  if (typeof info !== 'object' || info === null || !('processInfo' in info)) return 0;
  const list = info.processInfo;
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const p of list) {
    if (typeof p === 'object' && p !== null && 'cpuTime' in p && typeof p.cpuTime === 'number') {
      total += p.cpuTime;
    }
  }
  return total;
}

async function sample(cdp: CdpSession, seconds: number): Promise<number> {
  const before = await cpuSeconds(cdp);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const used = (await cpuSeconds(cdp)) - before;
  return (used / ((Date.now() - t0) / 1000)) * 100;
}

async function main(): Promise<void> {
  const pw = await loadPlaywright();
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>cpu</title>');
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });
  const browser = await pw.chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const page = await ctx.newPage();
    // getUserMedia needs a secure context, and http://127.0.0.1 is one while about:blank is not.
    await page.goto(`http://127.0.0.1:${String(port)}/`);
    const cdp = await page.context().newCDPSession(page);
    const state = await page.evaluate(PAGE_SETUP);
    // Idle baseline: tone is captured but the worklet is disconnected.
    await page.evaluate('window.__gavel.src.disconnect(window.__gavel.node)');
    const baseline = await sample(cdp, BASELINE_SECONDS);
    await page.evaluate('window.__gavel.src.connect(window.__gavel.node)');
    const loaded = await sample(cdp, MEASURE_SECONDS);
    const batches = await page.evaluate('window.__gavel.batches');
    const worklet = Math.max(0, loaded - baseline);

    const rows = [
      '### Capture CPU (T-VOX-112, informational)',
      '',
      '| metric | value |',
      '| --- | --- |',
      `| audio context state | ${String(state)} |`,
      `| baseline, no worklet (percent of one core) | ${baseline.toFixed(2)} |`,
      `| with worklet (percent of one core) | ${loaded.toFixed(2)} |`,
      `| worklet cost (percent of one core) | ${worklet.toFixed(2)} |`,
      `| 100 ms batches received | ${String(batches)} |`,
      `| measured seconds | ${String(MEASURE_SECONDS)} |`,
      `| target / hard limit (percent) | ${TARGET_PERCENT} / ${FAIL_ABOVE_PERCENT} |`,
      `| status | ${worklet <= TARGET_PERCENT ? 'within target' : 'above target'} |`,
      '',
    ].join('\n');
    process.stdout.write(rows);
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) appendFileSync(summary, rows);
    if (worklet > FAIL_ABOVE_PERCENT) {
      process.stderr.write(
        `Worklet CPU ${worklet.toFixed(2)} percent exceeds ${FAIL_ABOVE_PERCENT}\n`,
      );
      process.exitCode = 1;
    }
    if (typeof batches !== 'number' || batches === 0) {
      process.stderr.write('No audio reached the worklet\n');
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
