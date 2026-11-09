// The traffic simulation engine (FIX-68). Rooms run in waves, bidders join through the same
// endpoints the web app uses (POST /api/judge/join, POST /api/judge/rooms/:id/sim-hold, the
// WebSocket for bids), and every request goes through one guarded call path: allowed paths only,
// one request budget, one error window, one join gate. All I/O is injected, so the unit tests run
// the whole thing against fakes with no network.
import {
  Budget,
  ErrorWindow,
  LIMITS,
  RateGate,
  Recorder,
  USER_AGENT,
  isAllowedPath,
  planWaves,
  ulid,
} from './lib.mjs';

const HTTP_TIMEOUT_MS = 20_000;
const WS_JOIN_TIMEOUT_MS = 15_000;
const BID_ACK_TIMEOUT_MS = 10_000;
const SETTLE_WAIT_MS = 30_000;
const SETTLE_POLL_MS = 3_000;
const BID_GAP_MS = 3_000;
const BID_JITTER_MS = 3_000;
const FINAL_BAD = new Set(['FAILED_NEEDS_REVIEW']);

/**
 * io: { fetchImpl, openSocket(url, origin) -> socket, now(), sleep(ms), rand() }.
 * A socket has on(event, fn) for open/message/close/error, send(text) and close().
 * Returns the report object.
 */
export async function runSimulation(cfg, io) {
  const { fetchImpl, openSocket, now, sleep, rand } = io;
  const rec = new Recorder();
  const budget = new Budget(cfg.budget);
  const win = new ErrorWindow();
  const gate = new RateGate(LIMITS.joinsPerMinute, now, sleep);
  const waves = planWaves(cfg.rooms);
  const t0 = now();
  const st = {
    aborted: null,
    stopCreating: false,
    unavailable: null,
    firstRateLimit: null,
    notes: [],
    rooms: { created: 0, completed: 0, settled: 0, failed: 0, pending: 0 },
  };
  const wsHost = new URL(cfg.api).host;
  const wsUrl = `wss://${wsHost}/ws`;
  // Joins are paced, so the run needs this much time on top of the bidding time.
  const joinMs = (cfg.rooms * cfg.bidders * 60_000) / LIMITS.joinsPerMinute;
  const hardStop = t0 + cfg.durationMinutes * 60_000 + joinMs + 5 * 60_000;

  const abort = (reason) => {
    if (st.aborted === null) {
      st.aborted = reason;
      st.notes.push(`aborted: ${reason}`);
    }
  };
  const over = () => st.aborted !== null || now() > hardStop;

  function sample(step, started, status, ok) {
    const t = now();
    rec.record(step, t - started, status, ok);
    win.add(ok, t);
    if (win.tripped(t)) abort('error rate above 20 percent over a 30 second window');
  }

  /** One HTTP call. Never throws for a network problem; a path off the allow list throws. */
  async function call(step, method, path, opts = {}) {
    if (!isAllowedPath(path)) throw new Error(`path not allowed: ${path.split('?')[0]}`);
    if (!opts.cleanup) {
      if (over()) return { skipped: true, ok: false, status: 0 };
      if (!budget.take()) {
        abort('request budget spent');
        return { skipped: true, ok: false, status: 0 };
      }
    }
    const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const started = now();
    let res;
    let json = null;
    try {
      res = await fetchImpl(cfg.api + path, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    } catch {
      sample(step, started, 'neterr', false);
      return { ok: false, status: 0, json: null, headers: null };
    }
    const ok = res.status >= 200 && res.status < 300;
    sample(step, started, res.status, ok);
    return { ok, status: res.status, json, headers: res.headers };
  }

  // ----------------------------------------------------------------------------- sockets
  function openBidderSocket(room, bidder) {
    return new Promise((resolve) => {
      if (over() || !budget.take()) {
        resolve(null);
        return;
      }
      const started = now();
      let joined = false;
      let finished = false;
      const done = (v) => {
        if (!finished) {
          finished = true;
          resolve(v);
        }
      };
      let sock;
      try {
        sock = openSocket(wsUrl, cfg.web);
      } catch {
        sample('ws_join', started, 'neterr', false);
        done(null);
        return;
      }
      const timer = setTimeout(() => {
        if (!joined) {
          sample('ws_join', started, 'timeout', false);
          try {
            sock.close();
          } catch {
            /* closed already */
          }
          done(null);
        }
      }, WS_JOIN_TIMEOUT_MS);
      timer.unref?.();
      sock.on('open', () => {
        sock.send(
          JSON.stringify({
            v: 1,
            t: 'join',
            token: bidder.token,
            auctionId: room.auctionId,
            client: { name: USER_AGENT, version: '1' },
          }),
        );
      });
      sock.on('message', (raw) => {
        let m;
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (m.t === 'state' && m.snapshot) {
          bidder.minNext = m.snapshot.minNext ?? bidder.minNext;
          bidder.leaderId = m.snapshot.leaderId ?? null;
        } else if (m.t === 'price') {
          bidder.leaderId = m.leaderId ?? null;
          if (typeof m.price === 'number') bidder.minNext = m.price + room.minIncrement;
        } else if (m.t === 'hammer') {
          bidder.ended = true;
        } else if ((m.t === 'bid_accepted' || m.t === 'bid_rejected') && m.mid) {
          const p = bidder.pending.get(m.mid);
          if (p) {
            bidder.pending.delete(m.mid);
            p(m);
          }
        }
        if (!joined && (m.t === 'state' || m.t === 'registered')) {
          joined = true;
          clearTimeout(timer);
          sample('ws_join', started, 'ok', true);
          done(sock);
        } else if (!joined && m.t === 'error') {
          joined = true;
          clearTimeout(timer);
          sample('ws_join', started, `error:${m.code ?? 'unknown'}`, false);
          done(null);
        }
      });
      const failed = (why) => {
        if (!joined) {
          joined = true;
          clearTimeout(timer);
          sample('ws_join', started, why, false);
          done(null);
        }
      };
      sock.on('error', () => failed('wserror'));
      sock.on('close', () => failed('wsclosed'));
    });
  }

  function sendBid(sock, bidder, amount) {
    return new Promise((resolve) => {
      if (over() || !budget.take()) {
        resolve(null);
        return;
      }
      const mid = ulid(now(), rand);
      const started = now();
      const timer = setTimeout(() => {
        bidder.pending.delete(mid);
        sample('bid', started, 'timeout', false);
        resolve(null);
      }, BID_ACK_TIMEOUT_MS);
      timer.unref?.();
      bidder.pending.set(mid, (m) => {
        clearTimeout(timer);
        if (m.t === 'bid_accepted') sample('bid', started, 'accepted', true);
        else sample('bid', started, `rejected:${m.reason ?? 'unknown'}`, true);
        resolve(m);
      });
      try {
        sock.send(JSON.stringify({ v: 1, t: 'bid', mid, amount, source: 'manual' }));
      } catch {
        clearTimeout(timer);
        bidder.pending.delete(mid);
        sample('bid', started, 'neterr', false);
        resolve(null);
      }
    });
  }

  // ----------------------------------------------------------------------------- one bidder
  async function runBidder(room, idx, deadline) {
    await gate.wait();
    if (over()) return;
    const j = await call('join', 'POST', '/api/judge/join', {
      body: { code: room.joinCode, displayName: `sim ${room.label}-${idx + 1}` },
    });
    if (!j.ok || !j.json?.sessionToken) return;
    const bidder = {
      token: j.json.sessionToken,
      id: j.json.bidderId,
      minNext: room.reserve,
      leaderId: null,
      ended: false,
      pending: new Map(),
    };
    const ceiling = room.presets[idx % room.presets.length];
    const h = await call('sim_hold', 'POST', `/api/judge/rooms/${room.auctionId}/sim-hold`, {
      token: bidder.token,
      body: { ceilingCents: ceiling, name: `sim ${room.label}-${idx + 1}` },
    });
    if (!h.ok) return;
    room.holds += 1;
    const sock = await openBidderSocket(room, bidder);
    try {
      while (!over() && now() < deadline && !bidder.ended) {
        await sleep(BID_GAP_MS + rand() * BID_JITTER_MS);
        if (over() || now() >= deadline) break;
        if (sock && bidder.leaderId !== bidder.id) {
          await sendBid(sock, bidder, bidder.minNext);
        }
        await call('snapshot_poll', 'GET', `/api/auctions/${room.auctionId}/snapshot`, {
          token: bidder.token,
        });
      }
    } finally {
      try {
        sock?.close();
      } catch {
        /* closed already */
      }
    }
  }

  // ----------------------------------------------------------------------------- one room
  async function finishRoom(room) {
    // Cleanup calls ignore an abort and the budget: a hammered room frees its slot at once.
    const h = await call('hammer', 'POST', `/api/auctions/${room.auctionId}/control`, {
      token: room.auctioneerToken,
      body: { controlId: `sim-${ulid(now(), rand)}`, action: 'hammer' },
      cleanup: true,
    });
    if (!h.ok) st.notes.push(`hammer answered ${h.status} for ${room.label}`);
    let final = 'pending';
    const until = now() + SETTLE_WAIT_MS;
    for (;;) {
      const s = await call('settle_poll', 'GET', `/api/auctions/${room.auctionId}/snapshot`, {
        token: room.auctioneerToken,
        cleanup: true,
      });
      const state = s.json?.snapshot?.settlement?.auctionState;
      if (state === 'SETTLED') {
        final = 'settled';
        break;
      }
      if (FINAL_BAD.has(state)) {
        final = 'failed';
        break;
      }
      if (now() >= until) break;
      await sleep(SETTLE_POLL_MS);
    }
    if (final === 'settled') st.rooms.settled += 1;
    else if (final === 'failed') st.rooms.failed += 1;
    else st.rooms.pending += 1;
    if (st.aborted === null) st.rooms.completed += 1;
  }

  // ----------------------------------------------------------------------------- the run
  const cap = await call('capabilities', 'GET', '/api/judge/capabilities');
  if (!cap.ok || cap.json?.judgeRooms !== true || cap.json?.simHolds !== true) {
    st.unavailable = `judge rooms with simulated holds are not available (status ${cap.status})`;
  } else if (cap.json?.accepting === false) {
    st.unavailable = 'judge rooms are not accepting new rooms right now';
  }
  if (st.unavailable) st.notes.push(st.unavailable);

  let waveNo = 0;
  for (const size of st.unavailable ? [] : waves) {
    if (over() || st.stopCreating) break;
    waveNo += 1;
    const rooms = [];
    // Creates go one after another, so the first 429 stops the run before more are asked for.
    for (let i = 0; i < size && !st.stopCreating && !over(); i += 1) {
      const c = await call('create_room', 'POST', '/api/judge/rooms', {
        body: { title: 'Traffic sim lot' },
      });
      if (c.status === 429) {
        st.stopCreating = true;
        st.firstRateLimit = {
          code: typeof c.json?.error === 'string' ? c.json.error : null,
          retryAfter: c.headers?.get('retry-after') ?? null,
          roomsCreatedBefore: st.rooms.created,
        };
        break;
      }
      if (c.status === 404 || c.status === 503) {
        st.stopCreating = true;
        st.notes.push(`room creation answered ${c.status}; stopped`);
        break;
      }
      if (!c.ok || !c.json?.auctionId) continue;
      st.rooms.created += 1;
      const room = {
        label: `w${waveNo}r${i + 1}`,
        auctionId: c.json.auctionId,
        joinCode: c.json.joinCode,
        auctioneerToken: c.json.auctioneerToken,
        presets: [2000, 5000],
        reserve: 1000,
        minIncrement: 500,
        holds: 0,
      };
      const snap = await call('snapshot_setup', 'GET', `/api/auctions/${room.auctionId}/snapshot`, {
        token: room.auctioneerToken,
      });
      const config = snap.json?.snapshot?.config;
      if (config?.ceilingPresets?.length) room.presets = config.ceilingPresets;
      if (typeof config?.reserve === 'number') room.reserve = config.reserve;
      if (typeof config?.minIncrement === 'number') room.minIncrement = config.minIncrement;
      rooms.push(room);
    }
    if (rooms.length === 0) continue;
    const deadline = now() + (cfg.durationMinutes * 60_000) / waves.length + joinMs / waves.length;
    await Promise.all(
      rooms.map(async (room) => {
        await Promise.all(
          Array.from({ length: cfg.bidders }, (_, k) => runBidder(room, k, deadline)),
        );
        await finishRoom(room);
      }),
    );
  }

  let verdict = 'completed';
  let reason = '';
  if (st.unavailable) {
    verdict = 'not_available';
    reason = st.unavailable;
  } else if (st.firstRateLimit) {
    verdict = 'rate_limited';
    reason = 'first 429 on room creation, run stopped';
  } else if (st.aborted) {
    verdict = 'aborted';
    reason = st.aborted;
  } else if (now() > hardStop) {
    verdict = 'aborted';
    reason = 'time limit';
  }
  return {
    verdict,
    reason,
    target: cfg.web,
    api: cfg.api,
    config: { rooms: cfg.rooms, bidders: cfg.bidders, durationMinutes: cfg.durationMinutes },
    budget: { max: budget.max, used: budget.used },
    elapsedMs: now() - t0,
    rooms: st.rooms,
    firstRateLimit: st.firstRateLimit,
    summary: rec.summary(),
    notes: st.notes,
  };
}
