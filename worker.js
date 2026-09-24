// AnyChat proxy — deploy as a Cloudflare Worker (free).
// It forwards requests to the real AI provider server-side, which avoids
// the CORS blocks that stop browsers from calling OpenAI / Anthropic directly.
//
// Deploy: `wrangler deploy` (see README), or paste the code into the
// Cloudflare Workers dashboard. Then paste the resulting URL into the app's
// "Proxy URL" setting.
//
// Your API key is sent in the Authorization / x-api-key header, forwarded
// straight to the provider. It never touches this worker beyond passing through.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // /proxy?url=<target>  — forward the request to <target>
    if (url.pathname === '/proxy') {
      const target = url.searchParams.get('url');
      if (!target) return new Response('missing ?url=', { status: 400 });

      let upstream;
      try {
        upstream = await fetch(target, {
          method: request.method,
          headers: forwardHeaders(request.headers),
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        });
      } catch (e) {
        return new Response('upstream error: ' + e.message, { status: 502, headers: corsHeaders() });
      }

      const out = new Headers();
      out.set('Access-Control-Allow-Origin', '*');
      out.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      out.set('Access-Control-Allow-Headers', '*');
      const ct = upstream.headers.get('content-type');
      if (ct) out.set('content-type', ct);
      const cc = upstream.headers.get('cache-control');
      if (cc) out.set('cache-control', cc);

      return new Response(upstream.body, { status: upstream.status, headers: out });
    }

    return new Response('not found', { status: 404, headers: corsHeaders() });
  },
};

// Strip hop-by-hop headers before forwarding.
function forwardHeaders(h) {
  const drop = new Set(['host', 'content-length', 'connection', 'keep-alive',
    'proxy-authenticate', 'proxy-authorization', 'te', 'trailers',
    'transfer-encoding', 'upgrade', 'access-control-request-*']);
  const out = new Headers();
  for (const [k, v] of h.entries()) {
    if (drop.has(k.toLowerCase())) continue;
    out.set(k, v);
  }
  return out;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}