// Front door for the static GAVEL build. Runs first for every path (see wrangler.toml).
//
// Any other path: a real static file (favicon, robots.txt, ...) passes through. When the asset layer
// answers with the SPA fallback (index.html), the path is checked against the app's route table:
// a known page answers 200 as before, an unknown page answers 404 with the same index.html body, so
// the router shows its not-found screen and crawlers and link checkers see a real 404. A room route
// (/r/<id>/hub and the like) stays 200 whatever the id: the app asks the server whether the room
// exists. KNOWN_ROUTES must match packages/web/src/routes.tsx; a unit test fails when it drifts.
//
// /join/*: a join link is typed or scanned by people, so it can arrive mangled: a cut-off percent
// escape (/join/%E0%A4%A) or a traversal attempt (/join/..%2F..%2Fetc%2Fpasswd). The Workers asset
// layer answers those with a bare "400 Bad Request" page that has no way out. Here every /join/*
// path serves the app's entry page instead, and the router shows its own not-found screen with a
// link back (a real room code just opens the join flow, as before).
//
// /assets/*: the asset layer falls back to index.html (200, text/html) for an unknown path, and the
// /assets/* header rule then marks that HTML immutable for a year, so a stale tab or a deploy race
// could cache HTML under a script URL. A missing file under /assets/ answers 404 with a short
// no-store cache instead; a real file passes through untouched (immutable cache and all).

/** Route patterns served by the app (routes.tsx without the catch-all and the dev-only gallery). */
export const KNOWN_ROUTES = [
  '/',
  '/index.html',
  '/demo',
  '/demo/scripted',
  '/demo/scripted/join',
  '/demo/scripted/bid',
  '/try',
  '/verify',
  '/join/:roomId',
  '/r/:roomId/register',
  '/r/:roomId/return',
  '/r/:roomId/bid',
  '/r/:roomId/receipt',
  '/r/:roomId/console',
  '/r/:roomId/hub',
  '/r/:roomId/screen',
  '/r/:roomId/audit',
  '/ledger',
  '/ops',
  '/replay/:recordingId',
];

/** Same matching rules as the app's router: empty segments ignored, `:name` takes one segment. */
export function isKnownPath(pathname) {
  const have = pathname.split('/').filter((s) => s !== '');
  return KNOWN_ROUTES.some((pattern) => {
    const want = pattern.split('/').filter((s) => s !== '');
    if (want.length !== have.length) return false;
    return want.every((w, i) => {
      const h = have[i];
      if (!w.startsWith(':')) return w === h;
      try {
        decodeURIComponent(h);
        return true;
      } catch {
        return false;
      }
    });
  });
}

/** @param {Response} res */
function isSpaFallback(res) {
  const type = res.headers.get('content-type') ?? '';
  return res.ok && type.toLowerCase().startsWith('text/html');
}

/** @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> } }} env */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/assets/')) {
      const res = await env.ASSETS.fetch(request);
      if (!isSpaFallback(res)) return res;
      return new Response(request.method === 'HEAD' ? null : 'Not Found', {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    if (!pathname.startsWith('/join/')) {
      const res = await env.ASSETS.fetch(request);
      if (!isSpaFallback(res) || isKnownPath(pathname)) return res;
      return new Response(res.body, { status: 404, statusText: 'Not Found', headers: res.headers });
    }
    const entry = new Request(new URL('/', request.url), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: request.headers,
    });
    return env.ASSETS.fetch(entry);
  },
};
