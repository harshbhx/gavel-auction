// Shared helpers for the live stress suite: findings, page watchers, layout audit, room state.
// A finding is written to findings.jsonl with a screenshot, and it fails the test softly so that
// Playwright keeps the trace and video. Tokens never go into a finding: URLs are redacted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

export { test, expect };

export const WEB = (process.env.WEB_URL || 'https://gavel-web.creharsh.workers.dev').replace(
  /\/$/,
  '',
);
export const API = (process.env.API_URL || 'https://gavel-auction-z2nm.onrender.com').replace(
  /\/$/,
  '',
);
export const OUT = path.resolve(process.env.OUT || 'stress-out');
// Room links carry tokens in the fragment, so the state file lives outside the artifact folder.
export const STATE_FILE =
  process.env.STATE_FILE || path.join(os.tmpdir(), 'live-stress-state.json');
export const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let counter = 0;
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
export const clip = (s, n = 300) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, n);
export const redact = (u) =>
  String(u ?? '').replace(/([#?&](?:token|invite|a|s|c|code)=)[^&#\s]+/g, '$1<r>');

export function loadState() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Rooms are deleted 30 minutes after creation; after 26 minutes treat them as gone so
    // later specs skip instead of reporting an expired room as a bug.
    for (const k of Object.keys(st.rooms || {})) {
      if (st.rooms[k] && Date.now() - st.rooms[k].createdAt > 26 * 60 * 1000) st.rooms[k] = null;
    }
    return st;
  } catch {
    return { rooms: {}, note: 'no state file' };
  }
}

/** Writes a finding. `f`: sev (high|medium|low|info), page, title, steps, expected, actual, cause. */
export async function finding(page, f) {
  const info = test.info();
  counter += 1;
  const vp = page && !page.isClosed() ? page.viewportSize() : null;
  const id = `W${info.workerIndex}-${String(counter).padStart(3, '0')}`;
  let evidence = '';
  if (page && !page.isClosed() && f.screenshot !== false) {
    const file = `${id}-${slug(f.title)}.png`;
    try {
      await page.screenshot({ path: path.join(SHOTS, file), timeout: 8000 });
      evidence = `shots/${file}`;
    } catch {
      evidence = '';
    }
  }
  const rec = {
    id,
    sev: f.sev || 'medium',
    title: f.title,
    page: redact(f.page || (page && !page.isClosed() ? page.url() : '')).replace(WEB, ''),
    viewport: vp ? `${vp.width}x${vp.height}` : 'n/a',
    project: info.project.name,
    steps: f.steps || info.title,
    expected: f.expected || '',
    actual: clip(f.actual, 600),
    evidence,
    spec: `${path.basename(info.file)} :: ${info.title}`,
    cause: f.cause || '',
  };
  fs.appendFileSync(path.join(OUT, 'findings.jsonl'), JSON.stringify(rec) + '\n');
  if (rec.sev !== 'info')
    expect.soft(false, `${rec.sev}: ${rec.title} (${rec.page}) ${rec.actual}`).toBeTruthy();
  return rec;
}

/** Collects page errors, console errors and failed requests; call flush() to turn them into findings. */
export function watch(page, opts = {}) {
  const ev = { pageerror: [], console: [], failed: [], http5xx: [], http4xx: [] };
  page.on('pageerror', (e) => ev.pageerror.push(clip(e.message)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource/i.test(text)) return; // counted through the response hook
    ev.console.push(clip(text));
  });
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText || '';
    if (/ERR_ABORTED/.test(err)) return;
    if (opts.ignoreFailed && opts.ignoreFailed.test(r.url())) return;
    ev.failed.push(`${r.method()} ${redact(r.url()).slice(0, 120)} ${err}`);
  });
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 500) ev.http5xx.push(`${s} ${r.request().method()} ${redact(r.url()).slice(0, 120)}`);
    else if (s === 429)
      ev.http5xx.push(`429 ${r.request().method()} ${redact(r.url()).slice(0, 120)}`);
    else if (s >= 400)
      ev.http4xx.push(`${s} ${r.request().method()} ${redact(r.url()).slice(0, 120)}`);
  });
  return {
    ev,
    async flush(extra = {}) {
      const base = { page: page.url(), steps: extra.steps || test.info().title };
      if (ev.pageerror.length)
        await finding(page, {
          ...base,
          sev: 'high',
          title: 'Uncaught exception',
          expected: 'no uncaught exceptions',
          actual: ev.pageerror.slice(0, 3).join(' | '),
        });
      if (ev.console.length && !opts.allowConsole)
        await finding(page, {
          ...base,
          sev: 'medium',
          title: 'console.error output',
          expected: 'a clean console',
          actual: ev.console.slice(0, 3).join(' | '),
        });
      if (ev.failed.length)
        await finding(page, {
          ...base,
          sev: 'medium',
          title: 'Failed network request',
          expected: 'no failed requests',
          actual: ev.failed.slice(0, 4).join(' | '),
        });
      if (ev.http5xx.length)
        await finding(page, {
          ...base,
          sev: 'high',
          title: 'HTTP 5xx or 429 from a request',
          expected: 'no server errors and no rate limiting',
          actual: ev.http5xx.slice(0, 4).join(' | '),
        });
    },
  };
}

export async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

export async function gotoOk(page, url, opts = {}) {
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    status = res ? res.status() : 0;
  } catch (e) {
    return { status: 0, error: clip(e.message, 120) };
  }
  if (!opts.noSettle) await settle(page);
  return { status };
}

export const bodyText = async (page) =>
  page
    .locator('body')
    .innerText({ timeout: 4000 })
    .catch(() => '');

/** Everything the layout checks need, computed in the page. */
export async function auditLayout(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const vis = (e) => {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0)
        return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const desc = (e) => {
      const t = (e.innerText || e.getAttribute('aria-label') || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 28);
      const c =
        typeof e.className === 'string' && e.className
          ? '.' + e.className.trim().split(/\s+/)[0]
          : '';
      return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${c}${t ? ` "${t}"` : ''}`;
    };
    const all = [...document.querySelectorAll('body *')].filter(vis);
    const scrollW = document.documentElement.scrollWidth;
    const scrollerClip = (e) => {
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o !== 'visible' && p.getBoundingClientRect().right <= vw + 1) return true;
      }
      return false;
    };
    const offenders = [];
    if (scrollW > vw + 1) {
      for (const e of all) {
        const r = e.getBoundingClientRect();
        if (r.right > vw + 1 && !scrollerClip(e) && !e.closest('[aria-hidden="true"]')) {
          offenders.push(`${desc(e)} right=${Math.round(r.right)}`);
          if (offenders.length >= 5) break;
        }
      }
    }
    const clipped = [];
    for (const e of all) {
      if (clipped.length >= 5) break;
      const s = getComputedStyle(e);
      const hidden =
        ['hidden', 'clip'].includes(s.overflowX) || ['hidden', 'clip'].includes(s.overflowY);
      if (!hidden || e.clientWidth < 4 || e.clientHeight < 4) continue;
      if (!(e.innerText || '').trim()) continue;
      const overW = e.scrollWidth > e.clientWidth + 2 && s.textOverflow !== 'ellipsis';
      const overH = e.scrollHeight > e.clientHeight + 2;
      if ((overW || overH) && !e.querySelector('img,svg,canvas,video'))
        clipped.push(
          `${desc(e)} scroll ${e.scrollWidth}x${e.scrollHeight} client ${e.clientWidth}x${e.clientHeight}`,
        );
    }
    const inter = all.filter((e) =>
      e.matches('button,a[href],input:not([type=hidden]),select,textarea,[role=button]'),
    );
    const overlaps = [];
    const obscured = [];
    const rect = (e) => e.getBoundingClientRect();
    for (let i = 0; i < inter.length && overlaps.length < 4; i += 1) {
      for (let j = i + 1; j < inter.length && overlaps.length < 4; j += 1) {
        const a = inter[i];
        const b = inter[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = rect(a);
        const rb = rect(b);
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 2 && h > 2 && (w * h) / Math.min(ra.width * ra.height, rb.width * rb.height) > 0.25)
          overlaps.push(`${desc(a)} / ${desc(b)}`);
      }
    }
    for (const e of inter) {
      if (obscured.length >= 4) break;
      const r = rect(e);
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      if (top && top !== e && !e.contains(top) && !top.contains(e) && !(top.tagName === 'LABEL'))
        obscured.push(`${desc(e)} covered by ${desc(top)}`);
    }
    const coarse = matchMedia('(pointer: coarse)').matches;
    const tiny = coarse
      ? inter
          .filter((e) =>
            e.matches(
              'button,input:not([type=hidden]):not([type=radio]):not([type=checkbox]),select,[role=button]',
            ),
          )
          .filter((e) => Math.min(rect(e).width, rect(e).height) < 24)
          .slice(0, 4)
          .map((e) => `${desc(e)} ${Math.round(rect(e).width)}x${Math.round(rect(e).height)}`)
      : [];
    // Share of the first screen with no content: a 24 x 12 grid, a cell is used if any
    // text, image, control or graphic touches it.
    const leaf = all.filter((e) => {
      if (e.matches('img,svg,canvas,video,iframe,input,button,select,textarea')) return true;
      for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
      return false;
    });
    const C = 24;
    const R = 12;
    const used = new Set();
    for (const e of leaf) {
      const r = rect(e);
      const c0 = Math.max(0, Math.floor((r.left / vw) * C));
      const c1 = Math.min(C - 1, Math.floor(((r.right - 0.1) / vw) * C));
      const r0 = Math.max(0, Math.floor((r.top / vh) * R));
      const r1 = Math.min(R - 1, Math.floor(((r.bottom - 0.1) / vh) * R));
      for (let y = r0; y <= r1; y += 1) for (let x = c0; x <= c1; x += 1) used.add(y * C + x);
    }
    const docH = document.documentElement.scrollHeight;
    let bottom = 0;
    for (const e of leaf) bottom = Math.max(bottom, rect(e).bottom + window.scrollY);
    const bodyLen = (document.body.innerText || '').trim().length;
    return {
      vw,
      vh,
      scrollW,
      overflowX: scrollW > vw + 1,
      offenders,
      clipped,
      overlaps,
      obscured,
      tiny,
      emptyRatio: Number((1 - used.size / (C * R)).toFixed(2)),
      bottomEmpty: docH <= vh + 4 ? Number(Math.max(0, (vh - bottom) / vh).toFixed(2)) : 0,
      docH,
      bodyLen,
      h1: document.querySelectorAll('h1').length,
      main: document.querySelectorAll('main,[role=main]').length,
      lang: document.documentElement.lang,
      title: document.title,
    };
  });
}

/** Turns an audit into findings. `opts.key` marks pages where empty space matters. */
export async function reportAudit(page, a, opts = {}) {
  const base = { page: page.url(), steps: `open the page at ${a.vw}x${a.vh} and look` };
  if (a.bodyLen < 15)
    await finding(page, {
      ...base,
      sev: 'high',
      title: 'Page is blank',
      expected: 'visible content',
      actual: `body text length ${a.bodyLen}`,
    });
  if (a.overflowX)
    await finding(page, {
      ...base,
      sev: opts.key ? 'high' : 'medium',
      title: 'Horizontal scroll',
      expected: 'no horizontal scroll',
      actual: `scrollWidth ${a.scrollW} > ${a.vw}; ${a.offenders.join(' ; ')}`,
    });
  if (a.clipped.length)
    await finding(page, {
      ...base,
      sev: 'low',
      title: 'Clipped text or content',
      expected: 'text fully visible',
      actual: a.clipped.join(' ; '),
    });
  if (a.overlaps.length)
    await finding(page, {
      ...base,
      sev: 'medium',
      title: 'Overlapping controls',
      expected: 'controls do not overlap',
      actual: a.overlaps.join(' ; '),
    });
  if (a.obscured.length)
    await finding(page, {
      ...base,
      sev: 'medium',
      title: 'Control covered by another element',
      expected: 'every control reachable',
      actual: a.obscured.join(' ; '),
    });
  if (a.tiny.length)
    await finding(page, {
      ...base,
      sev: 'low',
      title: 'Touch target under 24px',
      expected: 'targets at least 24x24 CSS px',
      actual: a.tiny.join(' ; '),
    });
  if (a.vw >= 1024 && (a.emptyRatio > 0.35 || a.bottomEmpty > 0.35) && !opts.skipEmpty)
    await finding(page, {
      ...base,
      sev: opts.key ? 'medium' : 'low',
      title: 'More than 35% of the viewport is empty',
      expected: 'content fills most of a wide viewport',
      actual: `empty cells ${Math.round(a.emptyRatio * 100)}%, empty below content ${Math.round(a.bottomEmpty * 100)}% (docH ${a.docH}, vh ${a.vh})`,
    });
  if (!opts.skipLandmarks) {
    if (a.main !== 1)
      await finding(page, {
        ...base,
        sev: 'medium',
        title: 'Page has no single main landmark',
        expected: 'exactly one main',
        actual: `main count ${a.main}`,
        screenshot: false,
      });
    if (a.h1 !== 1)
      await finding(page, {
        ...base,
        sev: 'low',
        title: 'Page does not have exactly one h1',
        expected: 'one h1',
        actual: `h1 count ${a.h1}`,
        screenshot: false,
      });
    if (!a.lang)
      await finding(page, {
        ...base,
        sev: 'low',
        title: 'html has no lang',
        expected: 'lang attribute',
        actual: 'missing',
        screenshot: false,
      });
    if (!a.title || a.title.length < 3)
      await finding(page, {
        ...base,
        sev: 'low',
        title: 'Page has no title',
        expected: 'document.title',
        actual: `"${a.title}"`,
        screenshot: false,
      });
  }
}

export const STATIC_PAGES = [
  '/',
  '/try',
  '/demo',
  '/demo/scripted',
  '/demo/scripted/join',
  '/demo/scripted/bid',
  '/ops',
  '/replay/demo',
  '/gallery',
  '/this-does-not-exist',
];

export function roomPages(state) {
  const out = [];
  const A = state.rooms?.A;
  const B = state.rooms?.B;
  if (A) {
    out.push(['hub', A.hubUrl]);
    if (A.screenUrl) out.push(['screen', A.screenUrl]);
    out.push(['join', A.joinUrl]);
    out.push(['bid-nosession', `${WEB}/r/${A.roomId}/bid`]);
    out.push(['receipt-open', `${WEB}/r/${A.roomId}/receipt`]);
    out.push(['register-noinvite', `${WEB}/r/${A.roomId}/register`]);
  }
  if (B?.consoleUrl) out.push(['console', B.consoleUrl]);
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
