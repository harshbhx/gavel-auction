// Front door for the static GAVEL build. Runs first for /join/* and /assets/* (see wrangler.toml).
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
    const entry = new Request(new URL('/', request.url), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: request.headers,
    });
    return env.ASSETS.fetch(entry);
  },
};
