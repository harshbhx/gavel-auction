// Pure helpers for the traffic simulation (FIX-68). No network, no secrets, no timers of its own,
// so every rule here is unit-tested in CI (scripts/tests/traffic-sim.test.mjs).

export const USER_AGENT = 'gavel-traffic-sim';

/** Hosts the simulation may target. Anything else is refused, so a typo cannot load a stranger. */
export const ALLOWED_HOSTS = [
  /^([a-z0-9-]+\.)*dualmindlab\.tech$/,
  /^gavel-web\.creharsh\.workers\.dev$/,
  /^gavel-auction-z2nm\.onrender\.com$/,
];

export const LIMITS = {
  maxRooms: 8, // below the 12 creates per hour one address gets, leaving room for the walk
  maxBiddersPerRoom: 12, // the join cap is 20 per room
  maxDurationMinutes: 10,
  waveSize: 3,
  joinsPerMinute: 8, // the API allows 10 join attempts per minute per address, right or wrong
  errorWindowMs: 30_000,
  errorRate: 0.2,
  errorMinSamples: 20,
};

/** Paths the simulation may call. Everything else, webhooks and admin routes first, is refused. */
const ALLOWED_PATHS = [
  /^\/healthz$/,
  /^\/api\/judge\/capabilities$/,
  /^\/api\/judge\/rooms$/,
  /^\/api\/judge\/join$/,
  /^\/api\/judge\/rooms\/[0-9A-Za-z]+\/sim-hold$/,
  /^\/api\/auctions\/[0-9A-Za-z]+\/snapshot$/,
  /^\/api\/auctions\/[0-9A-Za-z]+\/control$/,
];
const FORBIDDEN_PATH = /webhook|admin|\/judge\/pause|\/judge\/key/i;

export function isAllowedPath(pathname) {
  if (typeof pathname !== 'string' || FORBIDDEN_PATH.test(pathname)) return false;
  return ALLOWED_PATHS.some((re) => re.test(pathname));
}

function origin(raw, label) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new Error(`${label} is not a URL`);
  }
  if (u.protocol !== 'https:') throw new Error(`${label} must be https`);
  if (u.username || u.password) throw new Error(`${label} must not carry credentials`);
  if (u.pathname !== '/' || u.search || u.hash) throw new Error(`${label} must be an origin only`);
  if (!ALLOWED_HOSTS.some((re) => re.test(u.hostname))) {
    throw new Error(`${label} host ${u.hostname} is not on the allow list`);
  }
  return u.origin;
}

function intIn(raw, label, min, max, fallback) {
  const v = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return v;
}

/** Budget of requests (HTTP calls plus socket frames) a run may spend. */
export function defaultBudget(rooms, bidders, durationMinutes) {
  const perBidder = 12 + Math.ceil((durationMinutes * 60) / 3);
  return Math.min(8000, 60 + rooms * (6 + bidders * perBidder));
}

/** Reads and checks the run settings. Throws with a plain message when anything is off. */
export function parseConfig(env) {
  if (env.CONFIRM !== 'yes') throw new Error("confirm must equal 'yes'");
  const web = origin(env.TARGET || 'https://gavel.dualmindlab.tech', 'target');
  const api = origin(env.API_URL || 'https://api.gavel.dualmindlab.tech', 'api');
  const rooms = intIn(env.ROOMS, 'rooms', 1, LIMITS.maxRooms, 3);
  const bidders = intIn(env.BIDDERS_PER_ROOM, 'bidders_per_room', 1, LIMITS.maxBiddersPerRoom, 6);
  const durationMinutes = intIn(
    env.DURATION_MINUTES,
    'duration_minutes',
    1,
    LIMITS.maxDurationMinutes,
    5,
  );
  const budget = intIn(
    env.REQUEST_BUDGET,
    'request_budget',
    50,
    20_000,
    defaultBudget(rooms, bidders, durationMinutes),
  );
  return { web, api, rooms, bidders, durationMinutes, budget };
}

/** Splits `rooms` into waves of at most `waveSize`: [3, 3, 2] for 8 rooms. */
export function planWaves(rooms, waveSize = LIMITS.waveSize) {
  const waves = [];
  for (let left = rooms; left > 0; left -= waveSize) waves.push(Math.min(left, waveSize));
  return waves;
}

/** Nearest-rank percentile of a list of numbers; 0 for an empty list. */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** True while the caller may spend one more request. */
export class Budget {
  constructor(max) {
    this.max = max;
    this.used = 0;
  }
  take() {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
}

/** Sliding window over the last `windowMs`: trips when more than `rate` of the samples failed. */
export class ErrorWindow {
  constructor(
    windowMs = LIMITS.errorWindowMs,
    rate = LIMITS.errorRate,
    minSamples = LIMITS.errorMinSamples,
  ) {
    this.windowMs = windowMs;
    this.rate = rate;
    this.minSamples = minSamples;
    this.samples = [];
  }
  add(ok, now) {
    this.samples.push({ at: now, ok });
    this.trim(now);
  }
  trim(now) {
    const from = now - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].at < from) this.samples.shift();
  }
  stats(now) {
    this.trim(now);
    const total = this.samples.length;
    const bad = this.samples.filter((s) => !s.ok).length;
    return { total, bad, rate: total === 0 ? 0 : bad / total };
  }
  tripped(now) {
    const s = this.stats(now);
    return s.total >= this.minSamples && s.rate > this.rate;
  }
}

/** Hands out starts at no more than `perMinute`; shared by every room so the cap holds for all. */
export class RateGate {
  constructor(perMinute, now, sleep) {
    this.gap = 60_000 / perMinute;
    this.now = now;
    this.sleep = sleep;
    this.next = 0;
  }
  async wait() {
    const t = this.now();
    const start = Math.max(t, this.next);
    this.next = start + this.gap;
    if (start > t) await this.sleep(start - t);
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID (26 chars, Crockford base32). `rand` returns a float in [0, 1). */
export function ulid(nowMs = Date.now(), rand = Math.random) {
  let t = nowMs;
  let time = '';
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let tail = '';
  for (let i = 0; i < 16; i += 1) tail += CROCKFORD[Math.floor(rand() * 32)];
  return time + tail;
}

/** Collects one sample per request: step, milliseconds, status label, ok. */
export class Recorder {
  constructor() {
    this.samples = [];
  }
  record(step, ms, status, ok) {
    this.samples.push({ step, ms: Math.max(0, Math.round(ms)), status: String(status), ok });
  }
  summary() {
    const steps = {};
    const statuses = {};
    for (const s of this.samples) {
      const e = (steps[s.step] ??= { n: 0, ok: 0, ms: [] });
      e.n += 1;
      if (s.ok) e.ok += 1;
      e.ms.push(s.ms);
      statuses[s.status] = (statuses[s.status] ?? 0) + 1;
    }
    const perStep = {};
    for (const [name, e] of Object.entries(steps)) {
      perStep[name] = {
        n: e.n,
        okRate: e.n === 0 ? 0 : e.ok / e.n,
        p50: percentile(e.ms, 50),
        p95: percentile(e.ms, 95),
        max: percentile(e.ms, 100),
      };
    }
    const total = this.samples.length;
    const ok = this.samples.filter((s) => s.ok).length;
    return { total, successRate: total === 0 ? 0 : ok / total, perStep, statuses };
  }
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/** The markdown shown in the job summary. Numbers come from the report only. */
export function renderMarkdown(report) {
  const out = [];
  out.push('## Traffic simulation report', '');
  out.push(`Verdict: **${report.verdict}**${report.reason ? ` (${report.reason})` : ''}`, '');
  out.push(
    `Target ${report.target}, API ${report.api}. Rooms asked ${report.config.rooms}, bidders per room ${report.config.bidders}, duration ${report.config.durationMinutes} min, budget ${report.budget.max} requests.`,
    '',
  );
  out.push(
    `Requests used ${report.budget.used} of ${report.budget.max}. Elapsed ${Math.round(report.elapsedMs / 1000)} s. Overall success ${pct(report.summary.successRate)} over ${report.summary.total} samples.`,
    '',
  );
  out.push('### Rooms', '');
  const r = report.rooms;
  out.push(
    `Created ${r.created}, completed ${r.completed}. Settled ${r.settled}, failed ${r.failed}, not final in time ${r.pending}.`,
    '',
  );
  out.push('### Per step (milliseconds)', '');
  out.push(
    '| step | n | success | p50 | p95 | max |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const [name, s] of Object.entries(report.summary.perStep)) {
    out.push(`| ${name} | ${s.n} | ${pct(s.okRate)} | ${s.p50} | ${s.p95} | ${s.max} |`);
  }
  out.push('', '### Status codes', '', '| status | count |', '| --- | ---: |');
  for (const [k, v] of Object.entries(report.summary.statuses).sort()) out.push(`| ${k} | ${v} |`);
  if (report.firstRateLimit) {
    const f = report.firstRateLimit;
    out.push(
      '',
      '### Rate limit',
      '',
      `First 429 on room creation: code ${f.code ?? 'unknown'}, retry-after ${f.retryAfter ?? 'none'} s, after ${f.roomsCreatedBefore} rooms.`,
    );
  }
  if (report.notes.length > 0) {
    out.push('', '### Notes', '');
    for (const n of report.notes) out.push(`- ${n}`);
  }
  return out.join('\n') + '\n';
}
