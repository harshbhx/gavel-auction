// Entry point of the traffic simulation (FIX-68): reads the settings from the environment, wires
// the real fetch, the real WebSocket (the `ws` package, installed by the workflow) and the real
// clock into the engine, then writes report.json and summary.md into OUT.
// It needs no secret and prints none.
import fs from 'node:fs';
import path from 'node:path';
import { parseConfig, renderMarkdown, USER_AGENT } from './lib.mjs';
import { runSimulation } from './sim.mjs';

const OUT = path.resolve(process.env.OUT || 'traffic-out');
fs.mkdirSync(OUT, { recursive: true });

let cfg;
try {
  cfg = parseConfig(process.env);
} catch (e) {
  console.error(`traffic-sim: ${e.message}`);
  process.exit(1);
}

const { default: WebSocket } = await import('ws');
const io = {
  fetchImpl: (url, init) => fetch(url, init),
  openSocket: (url, origin) =>
    new WebSocket(url, { headers: { origin, 'user-agent': USER_AGENT } }),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  rand: Math.random,
};

console.log(
  `traffic-sim: ${cfg.rooms} rooms x ${cfg.bidders} bidders, ${cfg.durationMinutes} min, budget ${cfg.budget}, api ${cfg.api}`,
);
const report = await runSimulation(cfg, io);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const md = renderMarkdown(report);
fs.writeFileSync(path.join(OUT, 'summary.md'), md);
console.log(md);
if (report.verdict !== 'completed') {
  console.log(`::warning title=traffic-sim ${report.verdict}::${report.reason}`);
}
