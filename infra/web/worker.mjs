// Front door for the static GAVEL build. Only /join/* runs this code first (see wrangler.toml).
//
// A join link is typed or scanned by people, so it can arrive mangled: a cut-off percent escape
// (/join/%E0%A4%A) or a traversal attempt (/join/..%2F..%2Fetc%2Fpasswd). The Workers asset layer
// answers those with a bare "400 Bad Request" page that has no way out. Here every /join/* path
// serves the app's entry page instead, and the router shows its own not-found screen with a link
// back (a real room code just opens the join flow, as before).

/** @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> } }} env */
export default {
  async fetch(request, env) {
    const entry = new Request(new URL('/', request.url), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: request.headers,
    });
    return env.ASSETS.fetch(entry);
  },
};
